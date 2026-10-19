import "server-only";
import { get, put, list, BlobPreconditionFailedError } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const localRoot = () => path.join(process.cwd(), "private");
export const isCloud = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const queue = new Map<string, Promise<unknown>>();

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return `secondbrain/${key}`;
}

export async function readRecord<T>(key: string): Promise<{ value: T; etag: string } | null> {
  const full = safeKey(key);
  if (isCloud()) {
    const result = await get(full, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { value: await new Response(result.stream).json() as T, etag: result.blob.etag };
  }
  if (process.env.VERCEL) throw new Error("Private cloud storage is not connected. No changes were saved.");
  try {
    const text = await fs.readFile(path.join(localRoot(), key), "utf8");
    return { value: JSON.parse(text) as T, etag: createHash("sha256").update(text).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRecord<T>(key: string, value: T, expectedEtag?: string | null): Promise<void> {
  const full = safeKey(key);
  const text = JSON.stringify(value);
  if (isCloud()) {
    await put(full, text, { access: "private", contentType: "application/json", addRandomSuffix: false,
      ...(expectedEtag ? { ifMatch: expectedEtag } : {}) });
    return;
  }
  if (process.env.VERCEL) throw new Error("Private cloud storage is not connected. No changes were saved.");
  const target = path.join(localRoot(), key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (expectedEtag !== undefined) {
    const current = await readRecord<unknown>(key);
    if ((current?.etag ?? null) !== expectedEtag) throw new ConflictError("This item changed. Reload it before saving.");
  }
  const tmp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, target);
}

export class ConflictError extends Error {}

export async function writeOriginal(id: string, format: string, bytes: Buffer) {
  const key = `originals/${id}.${format}`; safeKey(key);
  if (isCloud()) {
    await put(safeKey(key), bytes, { access: "private", addRandomSuffix: false, contentType: "application/octet-stream" });
  } else {
    if (process.env.VERCEL) throw new Error("Private cloud storage is not connected.");
    await fs.mkdir(path.join(localRoot(), "originals"), { recursive: true });
    await fs.writeFile(path.join(localRoot(), key), bytes, { mode: 0o600 });
  }
}

export async function readOriginal(id: string, format: string): Promise<ReadableStream<Uint8Array> | Uint8Array | null> {
  const key = `originals/${id}.${format}`; safeKey(key);
  if (isCloud()) {
    const result = await get(safeKey(key), { access: "private" });
    return result?.statusCode === 200 ? result.stream : null;
  }
  if (process.env.VERCEL) return null;
  try { return new Uint8Array(await fs.readFile(path.join(localRoot(), key))); }
  catch(error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function updateRecord<T>(key: string, initial: T, mutate: (value: T) => T): Promise<T> {
  const perform = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await readRecord<T>(key);
      const next = mutate(current?.value ?? initial);
      try { await writeRecord(key, next, current?.etag ?? null); return next; }
      catch (error) {
        if (!(error instanceof BlobPreconditionFailedError) && !(error instanceof ConflictError) && !String(error).includes("already exists")) throw error;
        if (attempt === 3) throw new ConflictError("Someone else updated this item. Please reload and try again.");
      }
    }
    throw new ConflictError("Save conflict");
  };
  const prior = queue.get(key) ?? Promise.resolve();
  const pending = prior.catch(() => {}).then(perform);
  queue.set(key, pending);
  try { return await pending; } finally { if (queue.get(key) === pending) queue.delete(key); }
}

export async function listRecords<T>(prefix: string): Promise<T[]> {
  if (!isCloud()) {
    if (process.env.VERCEL) return [];
    try {
      const names = await fs.readdir(path.join(localRoot(), prefix));
      return (await Promise.all(names.filter(n => n.endsWith(".json")).map(n => readRecord<T>(`${prefix}/${n}`)))).flatMap(r => r ? [r.value] : []);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  const values: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: safeKey(prefix + "/"), limit: 100, cursor });
    const records = await Promise.all(page.blobs.map(blob => readRecord<T>(blob.pathname.replace(/^secondbrain\//, ""))));
    values.push(...records.flatMap(r => r ? [r.value] : []));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return values;
}
