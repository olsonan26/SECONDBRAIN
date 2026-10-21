import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const marker = "__secondbrain_record_encoding__";
const version = "json-base64-v1";
const compressedVersion = "json-gzip-base64-v1";
const maxBytes = 20 * 1024 * 1024;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Postgres jsonb rejects NUL/isolated surrogates. Preserve the complete JSON, never strip source characters. */
export function encodeSupabaseRecord(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (typeof json !== "string") throw new Error("A private record must be JSON-serializable");
  if (Buffer.byteLength(json) > maxBytes) throw new Error("Private record exceeds decoded storage limit");
  // Large book records otherwise require multi-megabyte database responses on every load.
  if (Buffer.byteLength(json) >= 256 * 1024) {
    return { [marker]: compressedVersion, jsonBase64: gzipSync(Buffer.from(json, "utf8")).toString("base64"), sha256: sha(json) };
  }
  if (!/\\u0000|\\u[dD][89a-fA-F][0-9a-fA-F]{2}/.test(json)) return value;
  return { [marker]: version, jsonBase64: Buffer.from(json, "utf8").toString("base64"), sha256: sha(json) };
}

export function decodeSupabaseRecord<T>(stored: unknown): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored) || !(marker in stored)) return stored as T;
  const record = stored as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || ![version, compressedVersion].includes(String(record[marker])) || typeof record.jsonBase64 !== "string" || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256) || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.jsonBase64)) throw new Error("Invalid private record encoding");
  const bytes = Buffer.from(record.jsonBase64, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== record.jsonBase64) throw new Error("Invalid private record encoding");
  const json = (record[marker] === compressedVersion ? gunzipSync(bytes, { maxOutputLength: maxBytes }) : bytes).toString("utf8");
  if (sha(json) !== record.sha256) throw new Error("Private record fingerprint mismatch");
  return JSON.parse(json) as T;
}
