import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { supabaseRead, supabaseWrite, supabaseReadOriginal, supabaseWriteOriginal } from "../src/lib/supabase-storage";
import { ConflictError } from "../src/lib/storage-errors";

async function main() {
  const url = `${process.env.BRAIN_SUPABASE_URL}/functions/v1/secondbrain-storage`;
  const headers = { Authorization: `Bearer ${process.env.BRAIN_SUPABASE_GATEWAY_TOKEN}`, "Content-Type": "application/json" };
  const unauthorized = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "read", key: "secondbrain/settings.json" }) });
  assert.equal(unauthorized.status, 401);
  const initialize = await fetch(url, { method: "POST", headers, body: JSON.stringify({ op: "initialize" }) });
  assert.equal(initialize.status, 200, `Private bucket initialization returned ${initialize.status}`);
  assert.deepEqual(await initialize.json(), { ready: true, private: true });
  const id = randomUUID();
  const key = `secondbrain/_diagnostics/storage-probe-${id}.json`;
  assert.equal(await supabaseRead(key), null);
  await supabaseWrite(key, { probe: id, counter: 0 }, null);
  await assert.rejects(() => supabaseWrite(key, { counter: 9 }, null), ConflictError);
  const first = await supabaseRead<{ probe: string; counter: number }>(key);
  assert.ok(first);
  const updates = await Promise.allSettled(Array.from({ length: 6 }, (_, counter) => supabaseWrite(key, { probe: id, counter: counter + 1 }, first.etag)));
  assert.equal(updates.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(updates.filter(r => r.status === "rejected" && r.reason instanceof ConflictError).length, 5);
  console.log(JSON.stringify({ checkpoint: "atomic-record-saves-verified", probeKey: key }));
  const originalKey = `secondbrain/originals/storage-probe-${id}.bin`;
  assert.equal(await supabaseReadOriginal(originalKey), null);
  const bytes = Buffer.from(`Secondbrain private storage integrity probe ${id}`);
  await supabaseWriteOriginal(originalKey, bytes);
  await assert.rejects(() => supabaseWriteOriginal(originalKey, bytes), ConflictError);
  const downloaded = await supabaseReadOriginal(originalKey);
  assert.ok(downloaded);
  const result = Buffer.from(await new Response(downloaded).arrayBuffer());
  assert.equal(createHash("sha256").update(result).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
  const publicUrl = `${process.env.BRAIN_SUPABASE_URL}/storage/v1/object/public/secondbrain-private/${originalKey}`;
  assert.equal((await fetch(publicUrl)).ok, false, "Private original must not have public access");
  console.log(JSON.stringify({ unauthorizedRejected: true, bucketPrivate: true, concurrentSaves: { accepted: 1, rejected: 5 }, originalHashVerified: true, probeKey: key, originalProbeKey: originalKey, productionSwitched: false, paidAiCalls: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Storage verification failed"); process.exitCode = 1; });
