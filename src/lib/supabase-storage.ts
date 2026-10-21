import "server-only";
import { ConflictError } from "./storage-errors";
import { encodeSupabaseRecord, decodeSupabaseRecord } from "./supabase-record-codec";

// This is a narrow server-to-server credential, NOT a Supabase service-role key.
// The Edge Function keeps the database credential inside Supabase.
function configuration() {
  const url = process.env.BRAIN_SUPABASE_URL;
  const token = process.env.BRAIN_SUPABASE_GATEWAY_TOKEN;
  if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !token || token.length < 40) {
    throw new Error("Private Supabase storage is not configured. No changes were saved.");
  }
  return { url: `${url}/functions/v1/secondbrain-storage`, token };
}

async function call(query: string, init: RequestInit) {
  const { url, token } = configuration();
  const response = await fetch(url + query, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(60_000),
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (response.status === 409) throw new ConflictError("This item changed. Reload it before saving.");
  if (!response.ok) throw new Error(`Private Supabase storage is unavailable (${response.status}). No fallback or reset was performed.`);
  return response;
}

async function json<T>(body: unknown): Promise<T> {
  return (await call("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<T>;
}

export const supabaseRead = <T>(key: string) => json<{ record: { value: unknown; etag: string } | null }>({ op: "read", key }).then(r => r.record ? { ...r.record, value: decodeSupabaseRecord<T>(r.record.value) } : null);
export const supabaseWrite = (key: string, value: unknown, expectedEtag?: string | null) => json({ op: "write", key, value: encodeSupabaseRecord(value), checkVersion: expectedEtag !== undefined, expectedEtag: expectedEtag ?? null });

export async function supabaseList<T>(prefix: string): Promise<T[]> {
  const result: T[] = [];
  let after = "";
  for (;;) {
    const page = await json<{ records: { key: string; value: T; etag: string }[] }>({ op: "list", prefix, after });
    result.push(...page.records.map(r => decodeSupabaseRecord<T>(r.value)));
    if (page.records.length < 100) return result;
    const next = page.records.at(-1)!.key;
    if (next <= after) throw new Error("Invalid storage pagination. No changes were saved.");
    after = next;
  }
}

export async function supabaseWriteOriginal(key: string, bytes: Uint8Array) {
  await call(`?key=${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes as BodyInit });
}
export async function supabaseReadOriginal(key: string): Promise<ReadableStream<Uint8Array> | null> {
  const response = await call(`?key=${encodeURIComponent(key)}`, { method: "GET" });
  // The gateway uses 204 only for an explicitly missing object, not outages.
  return response.status === 204 ? null : response.body;
}
