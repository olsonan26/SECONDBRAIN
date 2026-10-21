import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(source: string) {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    process.env.BRAIN_STORAGE_BACKEND='supabase';
    process.env.BRAIN_SUPABASE_URL='https://testproject.supabase.co';
    process.env.BRAIN_SUPABASE_GATEWAY_TOKEN='s'.repeat(43);
    const load=async p=>{const m=await import(p);return m.default||m;};
    ${source}
  `], { encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("temporary 503 reads recover, while writes and persistent outages never reset or replay", () => run(`
  const s=await load('./src/lib/supabase-storage.ts');
  let calls=0;
  globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):Response.json({record:{value:{preserved:true},etag:'v1'}});
  assert.equal((await s.supabaseRead('secondbrain/corpus.json')).value.preserved,true);
  assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:503});};
  await assert.rejects(s.supabaseWrite('secondbrain/test.json',{preserved:true},'v1'),/unavailable/);
  assert.equal(calls,1,'Ambiguous writes must never be replayed');
  calls=0;await assert.rejects(s.supabaseRead('secondbrain/corpus.json'),/unavailable/);
  assert.equal(calls,2,'Read retries must be bounded');
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:401});};
  await assert.rejects(s.supabaseRead('secondbrain/corpus.json'),/unavailable/);assert.equal(calls,1);
`));

test("simultaneous book loads share one request, and invalidation cannot restore stale data", () => run(`
  const {getCorpus,invalidateCorpus}=await load('./src/lib/corpus.ts');
  let calls=0;const releases=[];
  globalThis.fetch=async()=>{calls++;return new Promise(resolve=>releases.push(resolve));};
  const a=getCorpus('main'),b=getCorpus('main');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls,1,'One large read per brain while in flight');
  invalidateCorpus('main');
  const c=getCorpus('main');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,2);
  releases[1](Response.json({record:{value:{version:2},etag:'new'}}));
  assert.equal((await c).version,2);
  releases[0](Response.json({record:{value:{version:1},etag:'old'}}));
  assert.equal((await a).version,1);assert.equal((await b).version,1);
  assert.equal((await getCorpus('main')).version,2,'Old in-flight load must not replace the new cache');
`));
