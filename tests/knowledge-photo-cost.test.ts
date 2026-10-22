import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("paired photos retain every original in all three checks and safely upgrade only untouched legacy batches", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    import os from 'node:os'; import path from 'node:path';
    process.env.BLOB_READ_WRITE_TOKEN=''; process.env.BLOB_STORE_ID=''; delete process.env.VERCEL;
    process.env.BRAIN_SESSION_SECRET='test-secret-at-least-thirty-two-characters-long';
    process.env.OPENROUTER_API_KEY=''; process.env.DEEPSEEK_API_KEY='';
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {createBrain}=await load('./src/lib/brains.ts');
    const {writeRecord,readRecord}=await load('./src/lib/storage.ts');
    const {brainKey}=await load('./src/lib/brain-scope.ts');
    const {saveSettings}=await load('./src/lib/model.ts');
    const {createKnowledgeJob,getKnowledgeJob,stepKnowledgeJob,resumeKnowledgeJob,pauseKnowledgeJob}=await load('./src/lib/knowledge.ts');
    const {getCorpus}=await load('./src/lib/corpus.ts');
    const cwd=process.cwd(),temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-photo-cost-'));
    process.chdir(temp);
    try {
      const brain=await createBrain('Photo cost fixture','Test only','Alex');
      const source={id:'book',title:'Timing book',filename:'photos',layer:'uploaded',format:'pdf',characters:1000,pages:3,sha256:'hash',importedAt:'',provenance:'test',originalAvailable:false};
      const bytes=Buffer.from([255,216,255,224,1,2,3,4,255,217]);
      const photos=Array.from({length:3},(_,i)=>({id:'p'+i,sourceId:'book',sourceTitle:'Book',page:i+1,section:'Timing',lineStart:1,lineEnd:2,text:'Rule '+i+': activation begins at the vernal equinox, not a birthday.',image:{id:'image-'+i,driveId:'valid_original_drive_id_'+i,sha256:createHash('sha256').update(bytes).digest('hex'),filename:'photo'+i+'.jpg',mimeType:'image/jpeg',ocrVerified:false}}));
      const corpus={version:1,importedAt:'',snapshotDate:'',sources:[source],passages:photos,nodes:[],edges:[],warnings:[]};
      await writeRecord(brainKey(brain.id,'corpus.json'),corpus);
      await saveSettings({provider:'openrouter',model:'deepseek/test-vision',apiKey:'sk-or-test-only-not-real',writingInstructions:'Preserve this.'});
      let calls=0, rejectPair=false;
      const attachments=[];
      globalThis.fetch=async(url,options)=>{
        if(String(url).endsWith('/models'))return Response.json({data:[{id:'deepseek/test-vision',architecture:{input_modalities:['text','image']},context_length:256000,pricing:{image:'0'}}]});
        if(String(url).startsWith('https://drive.google.com/'))return new Response(bytes,{headers:{'Content-Type':'image/jpeg'}});
        assert.match(String(url),/openrouter.ai/); calls++;
        const request=JSON.parse(options.body),content=request.messages[1].content;
        const data=JSON.parse(content[0].text), target=data.targetPassages;
        attachments.push(content.filter(part=>part.type==='image_url').length);
        assert.equal(attachments.at(-1),target.length,'Every targeted original is attached; paired pages never become OCR-only.');
        if(rejectPair && target.length===2)return Response.json({choices:[{finish_reason:'length',message:{content:'{'}}],usage:{prompt_tokens:1000,completion_tokens:12000,cost:.001}});
        const teachings=target.map(p=>({key:'t'+p.id,label:'Timing rule '+p.id,kind:'rule',topic:'Timing',text:p.text,aliases:[],applicationTags:['timing'],evidence:[{passageId:p.id,imageId:p.image.id,quote:'',visualObservation:'The printed rule explicitly gives the vernal equinox timing, not a birthday, for '+p.id}]}));
        const dispositions=target.map(p=>({passageId:p.id,disposition:'extracted',reason:'Exact timing rule retained.'}));
        const output=data.proposedTeachings?{teachings:data.proposedTeachings.map(t=>({key:t.key,supported:true,reason:'The rule matches the attached original.',usefulness:{decision:'teaching',reason:'A specific chart timing rule.',applicationQuestion:'When does activation begin?',teachingClass:'interpretation-rule',technicalStatement:t.text}})),relationships:[],passages:target.map(p=>({passageId:p.id,complete:true,reason:'All printed teachings checked.'})),gaps:[]}:data.candidate?{checks:data.candidate.teachings.map(t=>({key:t.key,supported:true,reason:'All details visible on the attached original.'})),additions:[],relationships:[],passages:dispositions,reviewComplete:true,gaps:[]}:{teachings,relationships:[],passages:dispositions,gaps:[]};
        return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1000,completion_tokens:1000,cost:.001}});
      };
      const job=await createKnowledgeJob({sourceIds:['book'],budgetUsd:1},brain.id,'Alex');
      assert.deepEqual((await getKnowledgeJob(job.id,brain.id)).batches.map(b=>b.passageIds.length),[2,1]);
      const key=brainKey(brain.id,'knowledge/jobs/'+job.id+'.json');
      const saved=(await readRecord(key)).value;
      saved.batches=photos.map((p,i)=>({id:String(i),passageIds:[p.id],phase:'extract',state:'pending',attempts:0,revision:0}));
      for(const protection of ['done','review','charged','leased','split','legacy-retry']) {
        const protectedJob=structuredClone(saved), batch=protectedJob.batches[1];
        protectedJob.stage='paused'; protectedJob.costUsd=.123; protectedJob.measuredCostUsd=.123; protectedJob.nodesAdded=7;
        if(protection==='done')batch.state='done';
        if(protection==='review')batch.phase='review';
        if(protection==='charged')batch.attempts=1;
        if(protection==='split')batch.revision=1;
        if(protection==='legacy-retry')protectedJob.passages[1].reason='Resuming a previously failed bounded request.';
        if(protection==='leased'){batch.state='leased';batch.lease={token:'active-test-lease',expiresAt:Date.now()+600000,reservation:.02};}
        await writeRecord(key,protectedJob);
        await resumeKnowledgeJob(job.id,brain.id);
        const preserved=await getKnowledgeJob(job.id,brain.id);
        assert.equal(preserved.batches.length,3,'Never pair across protected '+protection+' work.');
        assert.equal(preserved.costUsd,.123);
        assert.equal(preserved.nodesAdded,7);
        assert.equal(calls,0,'Resume and batching migration never purchase a model call.');
      }
      await writeRecord(key,saved);
      await pauseKnowledgeJob(job.id,brain.id);
      await resumeKnowledgeJob(job.id,brain.id);
      assert.deepEqual((await getKnowledgeJob(job.id,brain.id)).batches.map(b=>b.passageIds),[['p0','p1'],['p2']]);
      for(let phase=0;phase<6;phase++)await stepKnowledgeJob(job.id,brain.id);
      const done=await getKnowledgeJob(job.id,brain.id);
      assert.equal(done.stage,'complete',done.error);
      assert.equal(calls,6,'Three photo pages use six calls, not nine, with independent checks retained.');
      assert.deepEqual(attachments,[2,2,2,1,1,1]);
      assert.equal(done.costUsd,.006);
      assert.equal(done.budgetUsd,1);
      assert.equal(done.nodesAdded,3);
      const accepted=await getCorpus(brain.id);
      assert.deepEqual(accepted.passages,photos,'All original source/image references remain exact.');
      assert.equal(accepted.nodes.filter(n=>n.type==='teaching').every(n=>n.evidence[0].imageId),true);
      // A later explicit pass still rereads all pages. If two dense pages do
      // not fit, the existing safe split must preserve both targets and cost.
      const splitBrain=await createBrain('Dense paired photos','Test only','Alex');
      await writeRecord(brainKey(splitBrain.id,'corpus.json'),{...corpus,passages:photos.slice(0,2)});
      const split=await createKnowledgeJob({sourceIds:['book'],budgetUsd:1},splitBrain.id,'Alex');
      rejectPair=true;
      await stepKnowledgeJob(split.id,splitBrain.id);
      const splitDetail=await getKnowledgeJob(split.id,splitBrain.id);
      assert.deepEqual(splitDetail.batches.map(b=>b.passageIds),[['p0'],['p1']]);
      assert.equal(splitDetail.costUsd,.001,'The oversized call is never erased from spending.');
      await pauseKnowledgeJob(split.id,splitBrain.id); await resumeKnowledgeJob(split.id,splitBrain.id);
      assert.equal((await getKnowledgeJob(split.id,splitBrain.id)).batches.length,2,'Split revisions must never get paired back into the same oversized request.');
      rejectPair=false;
      for(let phase=0;phase<6;phase++)await stepKnowledgeJob(split.id,splitBrain.id);
      assert.equal((await getKnowledgeJob(split.id,splitBrain.id)).stage,'complete');
      assert.equal((await getKnowledgeJob(split.id,splitBrain.id)).costUsd,.007);
    } finally {process.chdir(cwd);assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'secondbrain-photo-cost-'));await rm(temp,{recursive:true,force:true});}
  `], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
