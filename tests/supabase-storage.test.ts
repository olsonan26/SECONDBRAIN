import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createHandler } from "../supabase/functions/secondbrain-storage/handler";

const token = "s".repeat(43);
const fingerprint = createHash("sha256").update(token).digest("hex");
const request = (body: unknown, credential = token) => new Request("https://project.supabase.co/functions/v1/secondbrain-storage", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("gateway authenticates before IO, validates namespacing, and never exposes service credentials", async () => {
  let calls = 0;
  const handler = createHandler({ url: "https://project.supabase.co", serviceKey: "sb_secret_private", tokenSha256: fingerprint, fetch: async () => { calls++; return new Response("private-upstream-error", { status: 500 }); } });
  assert.equal((await handler(request({ op: "read", key: "secondbrain/settings.json" }, "invalid"))).status, 401);
  assert.equal((await handler(request({ op: "read", key: "secondbrain/../settings.json" }))).status, 400);
  assert.equal((await handler(request({ op: "list", prefix: "secondbrain/brains/", after: "secondbrain/settings.json" }))).status, 400);
  assert.equal(calls, 0);
  const failure = await handler(request({ op: "read", key: "secondbrain/settings.json" }));
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private-upstream|sb_secret|ssssss/);
  assert.equal(calls, 1);
});

test("gateway distinguishes missing records from outages and passes CAS versions without bypassing them", async () => {
  const records = new Map<string, { key: string; value: unknown; etag: string }>();
  const handler = createHandler({ url: "https://project.supabase.co", serviceKey: "sb_secret_private", tokenSha256: fingerprint, fetch: async (url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "sb_secret_private");
    assert.equal(headers.get("authorization"), null, "New Supabase secret keys are not JWTs");
    const data = JSON.parse(String(init?.body));
    const key = data.p_key;
    if (String(url).endsWith("secondbrain_read_record")) return Response.json(records.has(key) ? [records.get(key)] : []);
    const old = records.get(key);
    if (data.p_check_version && (old?.etag ?? null) !== data.p_expected_version) return Response.json({ message: "Save conflict" }, { status: 409 });
    const version = randomUUID();
    records.set(key, { key, value: data.p_value, etag: version });
    return Response.json(version);
  } });
  assert.deepEqual(await (await handler(request({ op: "read", key: "secondbrain/settings.json" }))).json(), { record: null });
  const create = { op: "write", key: "secondbrain/settings.json", value: { instructions: "preserved" }, checkVersion: true, expectedEtag: null };
  assert.equal((await handler(request(create))).status, 200);
  assert.equal((await handler(request(create))).status, 409);
  const read = await (await handler(request({ op: "read", key: create.key }))).json();
  assert.equal((await handler(request({ ...create, expectedEtag: read.record.etag, value: { instructions: "updated" } }))).status, 200);
  assert.equal((await handler(request({ ...create, expectedEtag: read.record.etag }))).status, 409);
});

test("Supabase adapter paginates without Blob reads and fails closed on outages", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    process.env.BRAIN_STORAGE_BACKEND='supabase';
    process.env.BRAIN_SUPABASE_URL='https://testproject.supabase.co';
    process.env.BRAIN_SUPABASE_GATEWAY_TOKEN='s'.repeat(43);
    process.env.BLOB_READ_WRITE_TOKEN='must-not-be-used';
    const load=async p=>{const m=await import(p);return m.default||m;};
    const storage=await load('./src/lib/storage.ts');
    let calls=0;
    globalThis.fetch=async(url,init)=>{
      calls++;assert.match(url,/testproject.supabase.co/);
      assert.equal(init.headers.Authorization,'Bearer '+'s'.repeat(43));
      const body=JSON.parse(init.body);
      if(body.op==='list')return Response.json({records:body.after?[]:Array.from({length:100},(_,i)=>({key:'secondbrain/drafts/'+String(i).padStart(3,'0')+'.json',value:{i},etag:'version'}))});
      if(body.op==='read')return Response.json({record:null});
      return new Response('',{status:409});
    };
    assert.equal(storage.isCloud(),true);
    assert.equal((await storage.listRecords('drafts')).length,100);
    assert.equal(calls,2);
    assert.equal(await storage.readRecord('absent.json'),null);
    await assert.rejects(()=>storage.writeRecord('test.json',{a:1},null),storage.ConflictError);
    globalThis.fetch=async()=>new Response('',{status:503});
    await assert.rejects(()=>storage.readRecord('corpus.json'),/unavailable/);
    await assert.rejects(()=>storage.listRecords('drafts'),/unavailable/);
    await assert.rejects(()=>storage.readOriginal('book','pdf'),/unavailable/);
    delete process.env.BRAIN_SUPABASE_GATEWAY_TOKEN;
    await assert.rejects(()=>storage.readRecord('settings.json'),/not configured/);
    process.env.BRAIN_STORAGE_BACKEND='typo';
    assert.throws(()=>storage.isCloud(),/Unknown/);
  `], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("originals are private, streamed byte-for-byte, and storage failures never mean missing", async () => {
  const bytes = new Uint8Array([1, 4, 7, 0, 255]);
  const handler = createHandler({ url: "https://project.supabase.co", serviceKey: "legacy.jwt", tokenSha256: fingerprint, fetch: async (url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer legacy.jwt");
    assert.match(String(url), /secondbrain-private/);
    if (init?.method === "POST") {
      assert.equal(new Headers(init.headers).get("x-upsert"), "false");
      assert.deepEqual(new Uint8Array(init.body as ArrayBuffer), bytes);
      return Response.json({ saved: true });
    }
    return new Response(bytes);
  } });
  const url = "https://project.supabase.co/functions/v1/secondbrain-storage?key=secondbrain/originals/test.pdf";
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await handler(new Request(url, { method: "PUT", headers, body: bytes }))).status, 200);
  assert.deepEqual(new Uint8Array(await (await handler(new Request(url, { headers }))).arrayBuffer()), bytes);
  const unavailable = createHandler({ url: "https://project.supabase.co", serviceKey: "legacy.jwt", tokenSha256: fingerprint, fetch: async () => Response.json({ message: "Bucket not found" }, { status: 400 }) });
  assert.equal((await unavailable(new Request(url, { headers }))).status, 503);
});
