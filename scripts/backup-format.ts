import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import path from "node:path";

export type BackupEntry = { source: string; name: string };
type Part = { name: string; bytes: number; sha256: string };
export interface BackupManifest {
  version: 1; algorithm: "aes-256-gcm"; compression: "gzip"; createdAt: string;
  keyId: string; iv: string; tag: string; parts: Part[];
  files: number; originalBytes: number; completeCloudState: boolean; description: string;
}
const magic = "SECONDBRAIN_BACKUP_V1";
export function validBackupPath(name: string) {
  return !!name && name.length <= 500 && !name.includes("\\") && !name.includes(":") && !name.includes("\0") && !name.startsWith("/") && name.split("/").every(p => p !== ".." && p !== "." && p !== "");
}
export function parseBackupKey(text: string) {
  const value = text.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Recovery key must be the original 32-byte base64url key");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("Invalid recovery key");
  return key;
}
export async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

class PartsWriter extends Writable {
  parts: Part[] = [];
  private handle?: Awaited<ReturnType<typeof open>>;
  private size = 0;
  private hash = createHash("sha256");
  constructor(private directory: string, private maximum: number) { super(); }
  private async finishPart() {
    if (!this.handle) return;
    await this.handle.close(); this.handle = undefined;
    this.parts.push({ name: `archive.part-${String(this.parts.length + 1).padStart(3, "0")}.bin`, bytes: this.size, sha256: this.hash.digest("hex") });
    this.size = 0; this.hash = createHash("sha256");
  }
  private async consume(chunk: Buffer) {
    let position = 0;
    while (position < chunk.length) {
      if (!this.handle) this.handle = await open(path.join(this.directory, `archive.part-${String(this.parts.length + 1).padStart(3, "0")}.bin`), "wx", 0o600);
      const part = chunk.subarray(position, position + Math.min(chunk.length - position, this.maximum - this.size));
      let written = 0;
      while (written < part.length) written += (await this.handle.write(part.subarray(written))).bytesWritten;
      this.hash.update(part); this.size += part.length; position += part.length;
      if (this.size === this.maximum) await this.finishPart();
    }
  }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) { this.consume(chunk).then(() => callback(), callback); }
  _final(callback: (error?: Error | null) => void) { this.finishPart().then(() => callback(), callback); }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) { (this.handle?.close() ?? Promise.resolve()).then(() => callback(error), () => callback(error)); }
}

export async function createBackup(entries: BackupEntry[], directory: string, key: Buffer, details: { completeCloudState: boolean; description: string }, maximumPartBytes = 512 * 1024 * 1024) {
  if (key.length !== 32 || maximumPartBytes < 1024 || maximumPartBytes >= 2 ** 31) throw new Error("Invalid archive settings");
  const names = new Set<string>();
  const inventory: { source: string; name: string; bytes: number; sha256: string }[] = [];
  for (const entry of entries) {
    if (!validBackupPath(entry.name) || entry.name === ".secondbrain-restore-verified.json" || names.has(entry.name)) throw new Error("Unsafe or duplicate archive path");
    names.add(entry.name);
    const information = await stat(entry.source);
    if (!information.isFile()) throw new Error("Archive inputs must be regular files");
    inventory.push({ ...entry, bytes: information.size, sha256: await fileHash(entry.source) });
  }
  await mkdir(directory, { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const writer = new PartsWriter(directory, maximumPartBytes);
  const originalBytes = inventory.reduce((n, f) => n + f.bytes, 0);
  async function* content() {
    yield Buffer.from(`${magic}\n${JSON.stringify({ files: inventory.length, originalBytes })}\n`);
    for (const file of inventory) {
      yield Buffer.from(JSON.stringify({ name: file.name, bytes: file.bytes, sha256: file.sha256 }) + "\n");
      for await (const chunk of createReadStream(file.source)) yield chunk;
    }
    yield Buffer.from('{"end":true}\n');
  }
  await pipeline(Readable.from(content()), createGzip({ level: 1 }), cipher, writer);
  const manifest: BackupManifest = { version: 1, algorithm: "aes-256-gcm", compression: "gzip", createdAt: new Date().toISOString(), keyId: createHash("sha256").update(key).digest("hex").slice(0, 16), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), parts: writer.parts, files: inventory.length, originalBytes, ...details };
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  return manifest;
}

class Reader {
  private buffer: Buffer = Buffer.alloc(0);
  private iterator: AsyncIterator<Buffer>;
  constructor(file: string) { this.iterator = createReadStream(file)[Symbol.asyncIterator]() as AsyncIterator<Buffer>; }
  private async fill() {
    const next = await this.iterator.next();
    if (next.done) throw new Error("Truncated backup archive");
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, next.value]) : next.value;
  }
  async line() {
    while (!this.buffer.includes(10)) { if (this.buffer.length > 65536) throw new Error("Oversized archive header"); await this.fill(); }
    const i = this.buffer.indexOf(10), line = this.buffer.subarray(0, i).toString("utf8");
    if (i > 65536) throw new Error("Oversized archive header");
    this.buffer = this.buffer.subarray(i + 1); return line;
  }
  async copy(bytes: number, target: string) {
    const file = await open(target, "wx", 0o600), hash = createHash("sha256");
    try {
      while (bytes > 0) {
        if (!this.buffer.length) await this.fill();
        const chunk = this.buffer.subarray(0, Math.min(bytes, this.buffer.length));
        let written = 0;
        while (written < chunk.length) written += (await file.write(chunk.subarray(written))).bytesWritten;
        hash.update(chunk); bytes -= chunk.length; this.buffer = this.buffer.subarray(chunk.length);
      }
      return hash.digest("hex");
    } finally { await file.close(); }
  }
  async eof() { return this.buffer.length === 0 && (await this.iterator.next()).done; }
  async close() { await this.iterator.return?.(); }
}

export async function restoreBackup(directory: string, destination: string, key: Buffer) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as BackupManifest;
  if (manifest.version !== 1 || manifest.algorithm !== "aes-256-gcm" || manifest.compression !== "gzip" || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.files < 1 || !Number.isSafeInteger(manifest.originalBytes) || manifest.originalBytes < 0) throw new Error("Unsupported backup manifest");
  if (createHash("sha256").update(key).digest("hex").slice(0, 16) !== manifest.keyId) throw new Error("Wrong recovery key");
  const seen = new Set<string>();
  for (const part of manifest.parts) {
    if (!/^archive\.part-\d{3}\.bin$/.test(part.name) || seen.has(part.name)) throw new Error("Invalid archive part");
    seen.add(part.name);
    const file = path.join(directory, part.name);
    if ((await stat(file)).size !== part.bytes || await fileHash(file) !== part.sha256) throw new Error("Backup part integrity check failed");
  }
  // Authenticate/decompress into a private temporary file BEFORE restoring any
  // output. Wrong keys and corrupted ciphertext can never publish partial data.
  const temp = path.join(directory, `.restore-${randomBytes(8).toString("hex")}.tmp`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(manifest.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(manifest.tag, "base64url"));
  async function* parts() { for (const part of manifest.parts) for await (const chunk of createReadStream(path.join(directory, part.name))) yield chunk; }
  const output = await open(temp, "wx", 0o600);
  let reader: Reader | undefined;
  try {
    await pipeline(Readable.from(parts()), decipher, createGunzip(), output.createWriteStream());
    await mkdir(destination); // Refuse existing destinations; never overwrite.
    reader = new Reader(temp);
    if (await reader.line() !== magic) throw new Error("Invalid archive signature");
    const header = JSON.parse(await reader.line());
    if (header.files !== manifest.files || header.originalBytes !== manifest.originalBytes) throw new Error("Inventory mismatch");
    const names = new Set<string>();
    const restoredFiles: { name: string; bytes: number; sha256: string }[] = [];
    let total = 0;
    for (let i = 0; i < manifest.files; i++) {
      const item = JSON.parse(await reader.line());
      if (!validBackupPath(item.name) || names.has(item.name) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > manifest.originalBytes - total || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("Unsafe restore entry");
      names.add(item.name);
      const target = path.join(destination, ...item.name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      if (await reader.copy(item.bytes, target) !== item.sha256) throw new Error("Restored file hash mismatch");
      restoredFiles.push({ name: item.name, bytes: item.bytes, sha256: item.sha256 });
      total += item.bytes;
    }
    if (JSON.parse(await reader.line()).end !== true || !await reader.eof() || total !== manifest.originalBytes) throw new Error("Incomplete archive inventory");
    await writeFile(path.join(destination, ".secondbrain-restore-verified.json"), JSON.stringify({ version: 1, completeCloudState: manifest.completeCloudState, archiveManifestSha256: await fileHash(path.join(directory, "manifest.json")), files: restoredFiles }), { flag: "wx", mode: 0o600 });
    return { files: manifest.files, bytes: total, completeCloudState: manifest.completeCloudState };
  } finally { await reader?.close(); await output.close().catch(() => {}); await unlink(temp).catch(() => {}); }
}
