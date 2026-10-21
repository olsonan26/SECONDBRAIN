import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readRecord, writeRecord } from "../src/lib/storage";
import { getCorpus } from "../src/lib/corpus";
import { getSettings } from "../src/lib/model";
import { imageContextCeiling } from "../src/lib/knowledge-images";
import { createKnowledgeJob, getKnowledgeJob, listKnowledgeJobs, pauseKnowledgeJob } from "../src/lib/knowledge";
import { freshScanAuthorization, RECOVERED_ASTROLOGY_ID, ORIGINAL_PHOTO_SOURCE_ID, type FreshScanAuthorization } from "../src/lib/fresh-scan-policy";
import type { QuestionProfile } from "../src/lib/knowledge-question-profile";

async function main() {
  assert.ok(process.argv.includes("--authorize-additional-10"), "Explicit additional $10 authorization is required");
  assert.equal(process.env.BRAIN_STORAGE_BACKEND, "supabase");
  assert.equal(process.env.BRAIN_SUPABASE_URL,"https://gocduruhpoyshixuqhrc.supabase.co");
  const previous = await readRecord<Record<string,unknown>>("recovery-state.json");
  console.log(JSON.stringify({checkpoint:"recovery-state-read"}));
  assert.equal(previous?.value.pendingCloudRecovery,true); assert.equal(previous?.value.extractionBlocked,true);
  const corpus=await getCorpus(RECOVERED_ASTROLOGY_ID), settings=await getSettings();
  console.log(JSON.stringify({checkpoint:"sources-and-settings-read"}));
  const source=corpus.sources.find(s=>s.id===ORIGINAL_PHOTO_SOURCE_ID); assert.ok(source);
  assert.equal(corpus.passages.filter(p=>p.sourceId===source.id&&p.image).length,1028);
  assert.equal(settings.provider,"openrouter"); assert.ok(settings.apiKey);
  await imageContextCeiling(settings.model); // Capability lookup only, never a paid call.
  console.log(JSON.stringify({checkpoint:"image-model-verified"}));
  const oldPolicy=await readRecord<unknown>("recovery-fresh-scan.json");
  let policy=freshScanAuthorization(oldPolicy?.value);
  if(oldPolicy) {assert.ok(policy,"Existing fresh-scan authorization is invalid; not overwritten");assert.equal(policy.sourceSha256,source.sha256);assert.equal(policy.budgetUsd,10);}
  else {
    policy={version:1,mode:"fresh-separate-budget",brainId:RECOVERED_ASTROLOGY_ID,jobId:randomUUID(),sourceId:source.id,sourceSha256:source.sha256,budgetUsd:10,authorizedAt:new Date().toISOString(),authorizedBy:"Alex",maxPasses:3} satisfies FreshScanAuthorization;
    await writeRecord("recovery-fresh-scan.json",policy,null);
  }
  const profileKey=`brains/${RECOVERED_ASTROLOGY_ID}/knowledge-question-profile.json`;
  const profile=await readRecord<QuestionProfile>(profileKey); assert.ok(profile);
  assert.equal(profile.value.entries.length,493);
  const existing=(await listKnowledgeJobs(RECOVERED_ASTROLOGY_ID)).find(j=>j.id===policy.jobId);
  let job;
  if(existing) job=await getKnowledgeJob(policy.jobId,RECOVERED_ASTROLOGY_ID);
  else {
    const requirements=profile.value.entries.map(e=>e.text).join("\n");
    assert.ok(requirements.length<=60000,"Saved requirements need review before job creation");
    job=await createKnowledgeJob({sourceIds:[source.id],budgetUsd:10,requirements},RECOVERED_ASTROLOGY_ID,"Alex");
    await pauseKnowledgeJob(job.id,RECOVERED_ASTROLOGY_ID);
    job=await getKnowledgeJob(job.id,RECOVERED_ASTROLOGY_ID);
  }
  // Recover an interrupted preparation without accidentally starting the driver.
  if(job.stage==="queued"&&job.processedPassages===0&&job.costUsd===0) {
    await pauseKnowledgeJob(job.id,RECOVERED_ASTROLOGY_ID);
    job=await getKnowledgeJob(job.id,RECOVERED_ASTROLOGY_ID);
  }
  if(profile.value.jobId!==job.id) await writeRecord(profileKey,{...profile.value,jobId:job.id,updatedAt:new Date().toISOString()},profile.etag);
  const after=await readRecord("recovery-state.json"); assert.deepEqual(after,previous,"Original recovery marker must remain untouched");
  assert.equal(job.budgetUsd,10); assert.equal(job.totalPassages,1028);
  await mkdir("private/migration/fresh-scan",{recursive:true});
  await writeFile("private/migration/fresh-scan/authorization.json",JSON.stringify({policy,stage:job.stage,pass:job.scanPass,processed:job.processedPassages,costUsd:job.costUsd,legacyStateUnchanged:true,paidCallsStarted:0},null,2),{mode:0o600});
  console.log(JSON.stringify({authorized:true,brainId:policy.brainId,jobId:job.id,stage:job.stage,totalImages:job.totalPassages,requirements:profile.value.entries.length,capUsd:job.budgetUsd,costUsd:job.costUsd,legacyStateUnchanged:true,paidCallsStarted:0}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Fresh scan preparation stopped");if(error instanceof Error&&error.cause&&typeof error.cause==="object")console.error(JSON.stringify({transportError:(error.cause as {code?:string;name?:string}).code??(error.cause as {name?:string}).name}));process.exitCode=1;});
