import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeSupabaseRecord, encodeSupabaseRecord } from "../src/lib/supabase-record-codec";
import { supabaseRead, supabaseWrite } from "../src/lib/supabase-storage";
import type { Corpus } from "../src/lib/types";
import { RECOVERED_ASTROLOGY_ID } from "../src/lib/fresh-scan-policy";

async function main() {
  assert.equal(process.env.BRAIN_SUPABASE_URL, "https://gocduruhpoyshixuqhrc.supabase.co");
  const key = `secondbrain/brains/${RECOVERED_ASTROLOGY_ID}/corpus.json`;
  const url = `${process.env.BRAIN_SUPABASE_URL}/functions/v1/secondbrain-storage`;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.BRAIN_SUPABASE_GATEWAY_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ op: "read", key }), signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, "Source record must be readable before changing its encoding");
  const { record } = await response.json();
  assert.ok(record?.etag);
  const corpus = decodeSupabaseRecord<Corpus>(record.value);
  assert.equal(corpus.sources.length, 3);
  assert.equal(corpus.passages.length, 2749);
  const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const hash = fingerprint(corpus);
  const encoded = encodeSupabaseRecord(corpus);
  assert.equal(fingerprint(decodeSupabaseRecord(encoded)), hash);
  const beforeBytes = Buffer.byteLength(JSON.stringify(record.value));
  const afterBytes = Buffer.byteLength(JSON.stringify(encoded));
  assert.ok(afterBytes <= beforeBytes, "Compaction must never enlarge the stored record");
  const apply = process.argv.includes("--apply");
  if (apply && fingerprint(record.value) !== fingerprint(encoded)) {
    // Compare-and-swap: concurrent extraction changes must never be overwritten.
    await supabaseWrite(key, corpus, record.etag);
    const verified = await supabaseRead<Corpus>(key);
    assert.ok(verified);
    assert.equal(fingerprint(verified.value), hash, "Every source character and graph entry must be identical");
  }
  console.log(JSON.stringify({ applied: apply, beforeBytes, afterBytes, sha256: hash, sources: corpus.sources.length, passages: corpus.passages.length, nodes: corpus.nodes.length, checkpointChanged: false, paidAiCalls: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Storage compaction failed"); process.exitCode = 1; });
