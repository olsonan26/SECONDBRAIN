// Never changes BRAIN_STORAGE_BACKEND. A complete manifest is a prerequisite
// for a separately verified production cutover. Local fixture brains are NOT
// migration input. Source data is never deleted or overwritten by this script.
import { get, list } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { supabaseRead, supabaseWrite, supabaseReadOriginal, supabaseWriteOriginal } from "../src/lib/supabase-storage";

const folder = "private/migration/blob-export";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
};
async function inventory() {
  const result: { key: string; size: number; uploadedAt: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "secondbrain/", limit: 100, cursor });
    for (const blob of page.blobs) result.push({ key: blob.pathname, size: blob.size, uploadedAt: new Date(blob.uploadedAt).toISOString() });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("The existing private Blob credential is required");
  if (!process.env.BRAIN_SUPABASE_GATEWAY_TOKEN) throw new Error("The dedicated Supabase connection is required");
  await mkdir(folder, { recursive: true });
  const files = await inventory();
  assert.ok(files.some(f => f.key === "secondbrain/settings.json"), "Refusing a partial or wrong source workspace");
  assert.ok(files.some(f => f.key === "secondbrain/corpus.json"));
  assert.ok(files.some(f => /brains\/a2f66ffe-ae02-40eb-a264-a5697dcb6c5b\/corpus.json$/.test(f.key)), "The live Astrology brain is required");
  const manifest = { source: "Vercel Blob", destination: process.env.BRAIN_SUPABASE_URL, startedAt: new Date().toISOString(), complete: false, files, verified: [] as { key: string; sha256: string; semanticSha256?: string }[], blockedKey: "" };
  const save = () => writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await save();
  // A small settings read detects provider suspension before downloading books.
  const order = [...files].sort((a, b) => Number(b.key.endsWith("/settings.json")) - Number(a.key.endsWith("/settings.json")));
  for (const file of order) {
    if (!/^secondbrain\/[a-zA-Z0-9_./-]+$/.test(file.key) || file.key.includes("..")) throw new Error("Unexpected source key; migration stopped");
    manifest.blockedKey = file.key;
    await save();
    let bytes: Buffer;
    try {
      const source = await get(file.key, { access: "private", useCache: false });
      if (!source || source.statusCode !== 200) throw new Error("Source contents unavailable");
      bytes = Buffer.from(await new Response(source.stream).arrayBuffer());
      assert.equal(bytes.byteLength, file.size, "Source changed during migration");
    } catch {
      console.log(JSON.stringify({ complete: false, inventoried: files.length, verified: manifest.verified.length, blockedKey: file.key, reason: "The original store refused the source read. Restore read access or obtain a provider export before cutover.", productionSwitched: false }));
      process.exitCode = 2; return;
    }
    const backup = path.join(folder, file.key);
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, bytes, { mode: 0o600 });
    const digest = sha(bytes);
    assert.equal(sha(await readFile(backup)), digest);
    if (file.key.endsWith(".json")) {
      const value = JSON.parse(bytes.toString("utf8"));
      const existing = await supabaseRead(file.key);
      if (!existing) await supabaseWrite(file.key, value, null);
      const copied = await supabaseRead(file.key);
      assert.ok(copied);
      const semanticSha256 = sha(canonical(value));
      assert.equal(sha(canonical(copied.value)), semanticSha256, "Destination differs; existing data was NOT overwritten");
      manifest.verified.push({ key: file.key, sha256: digest, semanticSha256 });
    } else {
      const current = await supabaseReadOriginal(file.key);
      if (!current) await supabaseWriteOriginal(file.key, bytes);
      const copied = await supabaseReadOriginal(file.key);
      assert.ok(copied);
      assert.equal(sha(new Uint8Array(await new Response(copied).arrayBuffer())), digest, "Original bytes differ; existing data was NOT overwritten");
      manifest.verified.push({ key: file.key, sha256: digest });
    }
    await save();
  }
  assert.deepEqual(await inventory(), files, "Source changed during copying. Run again before cutover.");
  manifest.complete = true; manifest.blockedKey = "";
  await save();
  console.log(JSON.stringify({ complete: true, verified: manifest.verified.length, total: files.length, manifest: path.join(folder, "manifest.json"), productionSwitched: false }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Migration stopped without changing production"); process.exitCode = 1; });
