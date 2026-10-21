import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { freshScanAuthorization, RECOVERED_ASTROLOGY_ID, ORIGINAL_PHOTO_SOURCE_ID } from "../src/lib/fresh-scan-policy";

const policy={version:1,mode:"fresh-separate-budget",brainId:RECOVERED_ASTROLOGY_ID,jobId:"95502ebc-41b2-45c4-9cd6-c16bf5d87bde",sourceId:ORIGINAL_PHOTO_SOURCE_ID,sourceSha256:"a".repeat(64),budgetUsd:10,authorizedAt:"2026-10-21T20:00:00.000Z",authorizedBy:"Alex",maxPasses:3};
test("fresh scan authorization is explicit, bounded, and scoped to one image source and job",()=>{
  assert.equal(freshScanAuthorization(policy)?.budgetUsd,10);
  for(const bad of [{...policy,budgetUsd:11},{...policy,budgetUsd:NaN},{...policy,mode:"reset-old-budget"},{...policy,brainId:"main"},{...policy,sourceId:"pdf"},{...policy,jobId:"old"},{...policy,maxPasses:4},{...policy,authorizedAt:"invalid"}]) assert.equal(freshScanAuthorization(bad),null);
});
test("fresh scan cannot unlock other brains/jobs, reset its cap, or lose cumulative spending across three passes",()=>{
  const script=`
    import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
    process.env.BRAIN_STORAGE_BACKEND='local';delete process.env.VERCEL;process.env.OPENROUTER_API_KEY='sk-or-v1-test-only';
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {writeRecord,readRecord}=await load('./src/lib/storage.ts');
    const {getRecoveryState,assertExtractionRecoverySafe}=await load('./src/lib/recovery-state.ts');
    const {createKnowledgeJob,resumeKnowledgeJob,startNextKnowledgePass,getKnowledgeJob}=await load('./src/lib/knowledge.ts');
    const p=${JSON.stringify(policy)}, root=process.cwd(), temp=await mkdtemp(path.join(os.tmpdir(),'fresh-scan-'));
    let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No model or network calls allowed');};process.chdir(temp);
    try {
      const recovery={version:1,pendingCloudRecovery:true,extractionBlocked:true,sourceSnapshotDate:'2026-10-19',restoredAt:'2026-10-21T20:00:00.000Z'};
      await writeRecord('recovery-state.json',recovery);const before=await readRecord('recovery-state.json');
      await writeRecord('recovery-fresh-scan.json',p);
      assert.equal((await getRecoveryState(p.brainId)).extractionBlocked,false);
      assert.equal((await getRecoveryState('main')).extractionBlocked,true);
      await assert.rejects(()=>assertExtractionRecoverySafe('main',p.jobId),e=>e.status===409);
      await assert.rejects(()=>assertExtractionRecoverySafe(p.brainId,'f0d5c91a-9fb6-4234-8910-d27a790fc233'),e=>e.status===409);
      await writeRecord('brains.json',[{id:p.brainId,name:'Recovery',description:'',createdAt:'',createdBy:'Alex'}]);
      await writeRecord('settings.json',{provider:'openrouter',model:'deepseek/test',writingInstructions:'Keep exact evidence'});
      const source={id:p.sourceId,sha256:p.sourceSha256,title:'Original photos',format:'photo-book',characters:100,pages:1,layer:'uploaded',originalAvailable:false};
      const passage={id:'page-one',sourceId:p.sourceId,sourceTitle:source.title,page:1,section:'page',lineStart:1,lineEnd:1,text:'A source teaching with an exact condition.'};
      await writeRecord('brains/'+p.brainId+'/corpus.json',{version:1,snapshotDate:'',importedAt:'',sources:[source],passages:[passage],nodes:[],edges:[],warnings:[]});
      await assert.rejects(()=>createKnowledgeJob({sourceIds:['pdf'],budgetUsd:10},p.brainId,'Alex'),e=>e.status===409);
      const job=await createKnowledgeJob({sourceIds:[p.sourceId],budgetUsd:10},p.brainId,'Alex');assert.equal(job.id,p.jobId);
      await assert.rejects(()=>createKnowledgeJob({sourceIds:[p.sourceId],budgetUsd:10},p.brainId,'Alex'),e=>e.status===409);
      await assert.rejects(()=>resumeKnowledgeJob(p.jobId,p.brainId,{budgetUsd:11}),e=>e.status===409);
      const key='brains/'+p.brainId+'/knowledge/jobs/'+p.jobId+'.json';
      for(let pass=1;pass<=3;pass++) {
        const saved=await readRecord(key);await writeRecord(key,{...saved.value,stage:'complete',costUsd:.7,measuredCostUsd:.7,batches:saved.value.batches.map(b=>({...b,state:'done'})),passages:saved.value.passages.map(a=>({...a,disposition:'extracted'}))},saved.etag);
        if(pass<3) {const next=await startNextKnowledgePass(p.jobId,p.brainId);assert.equal(next.scanPass,pass+1);assert.equal(next.costUsd,.7);assert.equal(next.budgetUsd,10);}
        else await assert.rejects(()=>startNextKnowledgePass(p.jobId,p.brainId),e=>e.status===409);
      }
      await assert.rejects(()=>createKnowledgeJob({sourceIds:[p.sourceId],budgetUsd:10},p.brainId,'Alex'),e=>e.status===409);
      assert.equal((await getKnowledgeJob(p.jobId,p.brainId)).costUsd,.7);
      assert.deepEqual(await readRecord('recovery-state.json'),before);assert.equal(calls,0);
      await writeRecord('recovery-state.json',{broken:true});await assert.rejects(()=>assertExtractionRecoverySafe(p.brainId,p.jobId),e=>e.status===409);
    } finally {process.chdir(root);await rm(temp,{recursive:true,force:true});}
  `;
  const result=spawnSync(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",script],{cwd:process.cwd(),encoding:"utf8",windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
