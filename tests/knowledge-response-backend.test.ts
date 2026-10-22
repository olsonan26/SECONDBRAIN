import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("mixed invalid provider entries are archived without repeating a paid batch or bypassing verification", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    process.env.BLOB_READ_WRITE_TOKEN=''; process.env.BLOB_STORE_ID=''; delete process.env.VERCEL;
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SECONDBRAIN_STORAGE_PROVIDER;
    process.env.BRAIN_SESSION_SECRET='test-secret-at-least-thirty-two-characters-long';
    process.env.OPENROUTER_API_KEY=''; process.env.DEEPSEEK_API_KEY='';
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {createBrain}=await load('./src/lib/brains.ts');
    const {writeRecord,readRecord,listRecords}=await load('./src/lib/storage.ts');
    const {brainKey}=await load('./src/lib/brain-scope.ts');
    const {saveSettings}=await load('./src/lib/model.ts');
    const {createKnowledgeJob,getKnowledgeJob,stepKnowledgeJob,resumeKnowledgeJob}=await load('./src/lib/knowledge.ts');
    const {getCorpus}=await load('./src/lib/corpus.ts');
    const cwd=process.cwd(), temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-response-'));
    process.chdir(temp);
    try {
      const brain=await createBrain('Mixed response fixture','Test only','Alex');
      const source={id:'book',title:'Timing book',filename:'test.pdf',layer:'uploaded',format:'pdf',characters:1000,pages:1,sha256:'hash',importedAt:'',provenance:'test',originalAvailable:false};
      const passage={id:'p0',sourceId:'book',sourceTitle:'Timing book',page:1,section:'Timing',lineStart:1,lineEnd:2,text:'The activation begins at the vernal equinox, not on a birthday.'};
      await writeRecord(brainKey(brain.id,'corpus.json'),{version:1,importedAt:'',snapshotDate:'',sources:[source],passages:[passage],nodes:[],edges:[],warnings:[]});
      await saveSettings({provider:'openrouter',model:'deepseek/test',apiKey:'sk-or-test-only-not-real',writingInstructions:'Preserve this.'});
      const teaching=key=>({key,label:'Activation timing '+key,kind:'rule',topic:'Timing',text:passage.text,aliases:[],applicationTags:['timing'],evidence:[{passageId:'p0',quote:passage.text}]});
      const disposition={passageId:'p0',disposition:'extracted',reason:'Every reusable rule was considered.'};
      let calls=0;
      globalThis.fetch=async(url,options)=>{
        assert.match(String(url),/openrouter.ai/); calls++;
        const data=JSON.parse(JSON.parse(options.body).messages[1].content);
        const output=data.proposedTeachings?{
          teachings:data.proposedTeachings.map(t=>({key:t.key,supported:true,reason:'Exact source support.',usefulness:{decision:'teaching',reason:'A reusable timing rule with a precise exception.',applicationQuestion:'When does activation start?',teachingClass:t.key==='t1'?'unknown-class':'interpretation-rule',technicalStatement:t.key==='t2'?'too short':t.text}})),
          relationships:[],passages:[{passageId:'p0',complete:true,reason:'All proposed rules checked.'}],gaps:[]
        }:data.candidate?{
          checks:data.candidate.teachings.map(t=>({key:t.key,supported:true,reason:'Exact source support.'})),
          additions:[{...teaching('bad-addition'),kind:'not-a-kind'},teaching('bad-extraction')],relationships:[],passages:[disposition],reviewComplete:true,gaps:[]
        }:{teachings:[teaching('t0'),teaching('t1'),teaching('t2'),{...teaching('bad-extraction'),kind:'not-a-kind'}],relationships:[],passages:[disposition],gaps:[]};
        return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1000,completion_tokens:1000,cost:.001}});
      };
      const job=await createKnowledgeJob({sourceIds:['book'],budgetUsd:1},brain.id,'Alex');
      const extracted=await stepKnowledgeJob(job.id,brain.id);
      const detail=await getKnowledgeJob(job.id,brain.id);
      assert.equal(detail.batches[0].phase,'review',extracted.error);
      await stepKnowledgeJob(job.id,brain.id);
      const done=await stepKnowledgeJob(job.id,brain.id);
      assert.equal(calls,3,'No paid whole-response retry for isolated validation errors.');
      assert.equal(done.stage,'needs-review');
      assert.equal(done.costUsd,.003,'Every actual call charged exactly once.');
      assert.equal(done.budgetUsd,1);
      assert.equal(done.nodesAdded,1,'Only the fully supported t0 may be accepted.');
      const corpus=await getCorpus(brain.id);
      assert.equal(corpus.nodes.filter(n=>n.type==='teaching').length,1);
      assert.equal(corpus.nodes.find(n=>n.type==='teaching').label,'Activation timing t0');
      const completed=await getKnowledgeJob(job.id,brain.id);
      assert.equal(completed.passageAudit[0].disposition,'unresolved','Invalid entries cannot disappear from coverage.');
      const archives=await listRecords(brainKey(brain.id,'knowledge/review'));
      assert.equal(archives.filter(a=>a.validationHolds?.length).length,3,'Each affected phase archives its original response before advancing.');
      assert.ok(archives.some(a=>JSON.stringify(a.rawResponse).includes('not-a-kind')));
      assert.ok(archives.some(a=>JSON.stringify(a.rawResponse).includes('unknown-class')));
      const before=calls;
      await stepKnowledgeJob(job.id,brain.id);
      assert.equal(calls,before,'Completed partial work stays checkpointed.');
      assert.equal((await getKnowledgeJob(job.id,brain.id)).costUsd,.003);
      const mixedFetch=globalThis.fetch;
      globalThis.fetch=async(...args)=>{
        const response=await mixedFetch(...args), body=await response.json();
        const output=JSON.parse(body.choices[0].message.content);
        if(output.teachings && output.teachings[0]?.usefulness) output.teachings=output.teachings.filter(t=>t.key==='t0');
        else if(output.teachings) output.teachings=output.teachings.filter(t=>t.key==='t0');
        if(output.additions) output.additions=[];
        body.choices[0].message.content=JSON.stringify(output);
        return Response.json(body);
      };
      await resumeKnowledgeJob(job.id,brain.id);
      for(let phase=0;phase<3;phase++)await stepKnowledgeJob(job.id,brain.id);
      const retried=await getKnowledgeJob(job.id,brain.id);
      assert.equal(retried.stage,'complete','Explicit follow-up can resolve a previous hold; archived errors must not poison a new revision forever.');
      assert.equal(retried.costUsd,.006);
      assert.equal(retried.nodesAdded,1,'Previously verified knowledge must not be duplicated on follow-up.');
    } finally {
      process.chdir(cwd);
      assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'secondbrain-response-'));
      await rm(temp,{recursive:true,force:true});
    }
  `], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
