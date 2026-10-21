import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("spending refresh uses only the read-only key endpoint, redacts provider metadata, and labels unavailable usage", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import os from 'node:os'; import path from 'node:path';
    process.env.BLOB_READ_WRITE_TOKEN='';process.env.BLOB_STORE_ID='';delete process.env.VERCEL;
    process.env.BRAIN_SESSION_SECRET='test-secret-for-spending-read-only';
    const load=async path=>{const module=await import(path);return module.default||module;};
    const {getSpending}=await load('./src/lib/spend.ts');
    const {saveSettings}=await load('./src/lib/model.ts');
    const original=process.cwd(), temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-spending-'));
    process.chdir(temp);
    try {
      await saveSettings({provider:'openrouter',model:'deepseek/test',apiKey:'sk-or-secret-test-only',writingInstructions:'Preserve my shared writing rules.'});
      let requests=0;
      globalThis.fetch=async(url,options)=>{requests++;assert.equal(url,'https://openrouter.ai/api/v1/key');assert.equal(options.method,undefined);return Response.json({data:{usage:.54,usage_daily:.05,usage_monthly:.54,label:'private-key-label',creator_user_id:'private-user-id'}});};
      const report=await getSpending('main');
      assert.equal(report.providerSpend.totalUsd,.54);
      assert.equal(requests,1);
      assert.equal(report.extraction.trackedUsd,0);
      assert.equal(report.extraction.latestJob,null);
      assert.doesNotMatch(JSON.stringify(report),/sk-or|private-key-label|private-user-id/);
      globalThis.fetch=async()=>new Response('',{status:401});
      const unavailable=await getSpending('main');
      assert.equal(unavailable.providerSpend,null);
      assert.match(unavailable.providerError,/401/);
      await saveSettings({provider:'deepseek',model:'deepseek-chat',apiKey:'direct-test-only',writingInstructions:'Preserve my shared writing rules.'});
      globalThis.fetch=async()=>{throw new Error('A direct provider must not receive an OpenRouter request');};
      assert.equal((await getSpending('main')).providerSpend,null);
    } finally {process.chdir(original);await rm(temp,{recursive:true,force:true});}
  `], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
