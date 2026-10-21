import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { extractionSchema, finalVerificationSchema, independentlyVerifiedFragment, reviewFragment, reviewSchema, validatedEvidence } from "../src/lib/knowledge-schema";
import type { Corpus, Passage } from "../src/lib/types";

const passage: Passage = { id: "passage-1", sourceId: "book", sourceTitle: "Book", page: 123, section: "Technique", lineStart: 1, lineEnd: 3, text: "The activation begins at the vernal equinox.\nIt does not begin on a birthday." };
const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [passage], nodes: [], edges: [], warnings: [] };
const candidate = extractionSchema.parse({ teachings: [{ key: "t1", label: "Activation timing", kind: "rule", topic: "Profection Activation", applicationTags: ["timing"], text: "The book's activation begins at the vernal equinox, not at a birthday.", evidence: [{ passageId: passage.id, quote: "The activation begins at the vernal equinox. It does not begin on a birthday." }] }], passages: [{ passageId: passage.id, disposition: "extracted", reason: "Timing instruction." }], gaps: [] });

test("knowledge evidence matches original source words and preserves original whitespace/page", () => {
  const evidence = validatedEvidence(candidate.teachings[0].evidence, [passage]);
  assert.equal(evidence?.[0].quote, passage.text);
  assert.equal(evidence?.[0].page, 123);
  assert.equal(validatedEvidence([{ passageId: passage.id, quote: "The activation begins on a birthday." }], [passage]), null);
  assert.equal(validatedEvidence([{ passageId: "other-brain-passage", quote: passage.text }], [passage]), null);
});

test("independent review is required, invalid claims remain unresolved, and stable graph IDs are retry safe", () => {
  const review = reviewSchema.parse({ checks: [{ key: "t1", supported: true, reason: "The timing rule and the explicit birthday exclusion both appear." }], additions: [], relationships: [], passages: candidate.passages, reviewComplete: true, gaps: [] });
  const fragment = reviewFragment(candidate, review, [passage], "job", corpus);
  assert.equal(fragment.nodes.length, 1);
  assert.equal(fragment.nodes[0].knowledgeKind, "rule");
  assert.equal(fragment.edges[0].confidence, "EXTRACTED");
  assert.equal(fragment.audits[0].disposition, "extracted");
  assert.equal(reviewFragment(candidate, review, [passage], "job", corpus).nodes[0].id, fragment.nodes[0].id);
  const rejected = reviewFragment(candidate, { ...review, checks: [] }, [passage], "job", corpus);
  assert.equal(rejected.nodes.length, 0);
  assert.equal(rejected.audits[0].disposition, "unresolved");
  const omitted = reviewFragment(candidate, { ...review, passages: [] }, [passage], "job", corpus);
  assert.equal(omitted.audits[0].disposition, "unresolved");
  const incomplete = reviewFragment(candidate, { ...review, reviewComplete: false }, [passage], "job", corpus);
  assert.equal(incomplete.audits[0].disposition, "unresolved");
});

test("review-written additions and relationships require separate exact-once final entailment checks", () => {
  const addition = { ...candidate.teachings[0], key: "added", label: "Unsupported birthday rule", text: "This incorrectly claims that the activation starts on a birthday, despite quoting real but contrary source text." };
  const review = reviewSchema.parse({ checks: [{ key: "t1", supported: true, reason: "Explicit source timing." }], additions: [addition], relationships: [{ sourceKey: "t1", targetKey: "added", relation: "starts on birthday", evidence: candidate.teachings[0].evidence }], passages: candidate.passages, reviewComplete: true, gaps: [] });
  const verification = finalVerificationSchema.parse({ teachings: [{ key: "t1", supported: true, reason: "The distinction is explicit." }, { key: "added", supported: false, reason: "A real quote directly contradicts the proposed added birthday rule." }], relationships: [{ index: 0, supported: false, reason: "No relationship to a birthday start is taught." }], passages: [{ passageId: passage.id, complete: false, reason: "The reviewer introduced an unsupported birthday interpretation." }], gaps: [] });
  const accepted = independentlyVerifiedFragment(candidate, review, verification, [passage], "job", corpus);
  assert.equal(accepted.nodes.length, 1);
  assert.equal(accepted.nodes[0].label, "Activation timing");
  assert.equal(accepted.edges.length, 1, "Only the source-membership edge survives; the invented relationship is rejected.");
  assert.equal(accepted.audits[0].disposition, "unresolved");
  const missing = independentlyVerifiedFragment(candidate, { ...review, additions: [], relationships: [] }, { ...verification, teachings: [] }, [passage], "job", corpus);
  assert.equal(missing.nodes.length, 0, "A prior reviewer approval cannot replace a missing independent final check.");
  const duplicate = independentlyVerifiedFragment(candidate, { ...review, additions: [], relationships: [] }, { ...verification, teachings: [verification.teachings[0], verification.teachings[0]] }, [passage], "job", corpus);
  assert.equal(duplicate.nodes.length, 0, "Duplicate final checks fail closed.");
});

test("resumable three-worker extraction isolates storage, accounts real usage and enforces the hard budget", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {promises as fs} from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    process.env.BLOB_READ_WRITE_TOKEN=''; process.env.BLOB_STORE_ID=''; delete process.env.VERCEL;
    process.env.BRAIN_SESSION_SECRET='test-secret-at-least-thirty-two-characters-long';
    process.env.OPENROUTER_API_KEY=''; process.env.DEEPSEEK_API_KEY='';
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {createBrain}=await load('./src/lib/brains.ts');
    const {writeRecord,readRecord}=await load('./src/lib/storage.ts');
    const {brainKey}=await load('./src/lib/brain-scope.ts');
    const {saveSettings}=await load('./src/lib/model.ts');
    const {createKnowledgeJob,listKnowledgeJobs,getKnowledgeJob,stepKnowledgeJob,pauseKnowledgeJob,resumeKnowledgeJob}=await load('./src/lib/knowledge.ts');
    const {getCorpus}=await load('./src/lib/corpus.ts');
    const originalCwd=process.cwd();
    const temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-knowledge-'));
    process.chdir(temp);
    try {
      const originalRename=fs.rename;
      let renameAttempts=0;
      fs.rename=async(...args)=>{
        if(String(args[1]).endsWith('atomic-fixture.json') && renameAttempts++<2)throw Object.assign(new Error('temporary reader lock'),{code:'EPERM'});
        return originalRename(...args);
      };
      try { await writeRecord('atomic-fixture.json',{value:1}); }
      finally { fs.rename=originalRename; }
      assert.equal(renameAttempts,3,'Transient Windows reader locks must retry the same atomic rename.');
      assert.equal((await readRecord('atomic-fixture.json')).value.value,1);
      fs.rename=async(...args)=>{
        if(String(args[1]).endsWith('atomic-fixture.json'))throw Object.assign(new Error('permanent denied rename'),{code:'EPERM'});
        return originalRename(...args);
      };
      try { await assert.rejects(()=>writeRecord('atomic-fixture.json',{value:2}),/permanent denied rename/); }
      finally { fs.rename=originalRename; }
      assert.equal((await readRecord('atomic-fixture.json')).value.value,1,'Permanent failure must preserve the live destination, never delete it.');
      assert.equal((await fs.readdir(path.join(temp,'private'))).some(n=>n.endsWith('.tmp')),false,'Failed writes clean up only their owned temporary file.');
      const main={version:1,importedAt:'',snapshotDate:'',sources:[],passages:[],nodes:[],edges:[],warnings:['main-sentinel']};
      await writeRecord('corpus.json',main);
      const brain=await createBrain('Astrology','Test only','Alex');
      const source={id:'book',title:'Timing book',filename:'test.pdf',layer:'uploaded',format:'pdf',characters:1000,pages:13,sha256:'hash',importedAt:'',provenance:'test',originalAvailable:false};
      const passages=Array.from({length:13},(_,i)=>({id:'p'+i,sourceId:'book',sourceTitle:'Timing book',page:i+1,section:'Timing',lineStart:1,lineEnd:2,text:'Rule '+i+': The activation begins at the vernal equinox, not on a birthday. Preserve this exact timing distinction.'}));
      await writeRecord(brainKey(brain.id,'corpus.json'),{...main,sources:[source],passages,nodes:[{id:'source:book',label:'Book',type:'document',layer:'uploaded',community:'Your uploads',sourceIds:['book'],description:'Source',degree:0}],warnings:[]});
      await saveSettings({provider:'openrouter',model:'deepseek/test',apiKey:'sk-or-test-only-not-real',writingInstructions:'Do not overwrite this writing instruction.'});
      let calls=0;
      globalThis.fetch=async(url,options)=>{
        assert.match(String(url),/openrouter.ai/);
        calls++;
        const request=JSON.parse(options.body);
        assert.deepEqual(request.provider.max_price,{prompt:.35,completion:1.4,request:0});
        assert.equal(request.provider.sort,'throughput');
        assert.equal(request.max_tokens,12000);
        const data=JSON.parse(request.messages[1].content);
        const target=data.targetPassages;
        const teachings=target.map((p,i)=>({key:'t'+i,label:'Timing rule '+p.id,kind:'rule',topic:'Profection Activation',text:p.text,aliases:['activation'],applicationTags:['timing'],evidence:[{passageId:p.id,quote:p.text}]}));
        const dispositions=target.map(p=>({passageId:p.id,disposition:'extracted',reason:'The complete source timing distinction is retained.'}));
        const output=data.proposedTeachings?{teachings:data.proposedTeachings.map(t=>({key:t.key,supported:true,reason:'Every assertion, alias and application tag is explicitly supported.'})),relationships:[],passages:target.map(p=>({passageId:p.id,complete:true,reason:'Every teaching is retained and all conditions are preserved.'})),gaps:[]}:data.candidate?{checks:data.candidate.teachings.map(t=>({key:t.key,supported:true,reason:'Every condition is explicitly supported by the exact source passage.'})),additions:[],relationships:[],passages:dispositions,reviewComplete:true,gaps:[]}:{teachings,relationships:[],passages:dispositions,gaps:[]};
        await new Promise(resolve=>setTimeout(resolve,15));
        return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1500,completion_tokens:1000,cost:.001}});
      };
      const validFetch=globalThis.fetch;
      await assert.rejects(()=>createKnowledgeJob({sourceIds:['book'],budgetUsd:10.01},brain.id,'Alex'),/higher limit has not been authorized/);
      const concurrent=await Promise.allSettled(Array.from({length:2},()=>createKnowledgeJob({sourceIds:['book'],budgetUsd:1,requirements:'How does Profection Activation timing work?'},brain.id,'Alex')));
      assert.equal(concurrent.filter(v=>v.status==='fulfilled').length,1,'Concurrent creates must share one atomic source claim, never create two spending caps.');
      assert.equal(concurrent.filter(v=>v.status==='rejected' && v.reason.status===409).length,1);
      const created=concurrent.find(v=>v.status==='fulfilled').value;
      await assert.rejects(()=>getKnowledgeJob(created.id,'main'),/not in the selected brain/);
      await assert.rejects(()=>createKnowledgeJob({sourceIds:['book'],budgetUsd:1},brain.id,'Alex'),/already exists/);
      await pauseKnowledgeJob(created.id,brain.id);
      await stepKnowledgeJob(created.id,brain.id);
      assert.equal(calls,0);
      await resumeKnowledgeJob(created.id,brain.id);
      for(let i=0;i<24;i++) {
        await Promise.all(Array.from({length:4},()=>stepKnowledgeJob(created.id,brain.id)));
        if((await getKnowledgeJob(created.id,brain.id)).stage==='complete')break;
      }
      const finished=await getKnowledgeJob(created.id,brain.id);
      assert.equal(finished.stage,'complete',JSON.stringify(finished));
      assert.equal(calls,21,'Seven two-passage batches each require extraction, omission review and final verification.');
      assert.equal(finished.costUsd,.021);
      assert.equal(finished.measuredCostUsd,.021);
      assert.equal(finished.estimatedCostUsd,0);
      assert.ok(finished.estimatedTotalCostUsd>0,'The forecast is distinct from charged estimated usage.');
      assert.equal(finished.reservedUsd,0);
      assert.equal(finished.processedPassages,13);
      assert.equal(finished.nodesAdded,13);
      assert.equal(finished.passageAudit.every(p=>p.disposition==='extracted'),true);
      const extracted=await getCorpus(brain.id);
      assert.equal(extracted.nodes.length,14);
      assert.equal(extracted.edges.length,13);
      assert.equal(extracted.nodes.find(n=>n.type==='teaching').evidence[0].page,1);
      assert.deepEqual(await getCorpus('main'),main);
      await stepKnowledgeJob(created.id,brain.id);
      assert.equal(calls,21,'Completed jobs must never call the model again.');
      const capped=await createKnowledgeJob({sourceIds:['book'],budgetUsd:.01},brain.id,'Alex');
      const stopped=await stepKnowledgeJob(capped.id,brain.id);
      assert.equal(stopped.stage,'paused-budget');
      assert.equal(calls,21,'Insufficient reservation must stop before a paid call.');
      await assert.rejects(()=>resumeKnowledgeJob(capped.id,brain.id,{budgetUsd:11}),/higher limit has not been authorized/);
      assert.equal((await listKnowledgeJobs(brain.id)).length,2);
      const recoveryBrain=await createBrain('Crash recovery fixture','Test only','Alex');
      await writeRecord(brainKey(recoveryBrain.id,'corpus.json'),{...main,sources:[source],passages:[passages[0]],warnings:[]});
      const recovery=await createKnowledgeJob({sourceIds:['book'],budgetUsd:1},recoveryBrain.id,'Alex');
      await stepKnowledgeJob(recovery.id,recoveryBrain.id);
      await stepKnowledgeJob(recovery.id,recoveryBrain.id);
      let blockFinalJobWrite=false;
      globalThis.fetch=async(...args)=>{
        const result=await validFetch(...args);
        if(JSON.parse(JSON.parse(args[1].body).messages[1].content).proposedTeachings)blockFinalJobWrite=true;
        return result;
      };
      fs.rename=async(...args)=>{
        if(blockFinalJobWrite && String(args[1]).includes(path.sep+'knowledge'+path.sep+'jobs'+path.sep))throw Object.assign(new Error('simulated crash after corpus commit'),{code:'EPERM'});
        return originalRename(...args);
      };
      try { await assert.rejects(()=>stepKnowledgeJob(recovery.id,recoveryBrain.id),/simulated crash after corpus commit/); }
      finally { fs.rename=originalRename; globalThis.fetch=validFetch; }
      const callsBeforeReplay=calls;
      const replayed=await stepKnowledgeJob(recovery.id,recoveryBrain.id);
      assert.equal(replayed.stage,'complete');
      assert.equal(calls,callsBeforeReplay,'A committed graph receipt replays exact audits and usage without another paid model call.');
      assert.equal(replayed.costUsd,.003,'Every actual call is accounted exactly once after recovery.');
      const replayedDetail=await getKnowledgeJob(recovery.id,recoveryBrain.id);
      const replayedCorpus=await getCorpus(recoveryBrain.id);
      assert.equal(replayedDetail.passageAudit.every(a=>a.nodeIds.every(id=>replayedCorpus.nodes.some(n=>n.id===id))),true,'Replayed audits must refer to actually committed graph nodes.');
      const orphanBrain=await createBrain('Creation recovery fixture','Test only','Alex');
      await writeRecord(brainKey(orphanBrain.id,'corpus.json'),{...main,sources:[source],passages:[passages[0]],warnings:[]});
      fs.rename=async(...args)=>{
        if(String(args[1]).includes(path.sep+'knowledge'+path.sep+'jobs'+path.sep))throw Object.assign(new Error('simulated job creation crash'),{code:'EPERM'});
        return originalRename(...args);
      };
      try { await assert.rejects(()=>createKnowledgeJob({sourceIds:['book'],budgetUsd:1},orphanBrain.id,'Alex'),/simulated job creation crash/); }
      finally { fs.rename=originalRename; }
      const recoveredOrphan=await listKnowledgeJobs(orphanBrain.id);
      assert.equal(recoveredOrphan.length,1,'The source-claim snapshot restores an otherwise invisible interrupted job.');
      await assert.rejects(()=>createKnowledgeJob({sourceIds:['book'],budgetUsd:1},orphanBrain.id,'Alex'),/already exists/);
      const failedBrain=await createBrain('Truncation fixture','Test only','Alex');
      await writeRecord(brainKey(failedBrain.id,'corpus.json'),{...main,sources:[source],passages:[passages[0]],warnings:[]});
      let failedCalls=0;
      globalThis.fetch=async()=>{failedCalls++;return Response.json({choices:[{finish_reason:'length',message:{content:'{'}}],usage:{prompt_tokens:100,completion_tokens:12000,cost:.001}});};
      const truncated=await createKnowledgeJob({sourceIds:['book'],budgetUsd:1},failedBrain.id,'Alex');
      for(let i=0;i<4;i++)await stepKnowledgeJob(truncated.id,failedBrain.id);
      const failed=await getKnowledgeJob(truncated.id,failedBrain.id);
      assert.equal(failed.stage,'needs-review');
      assert.equal(failedCalls,3,'Repeated truncation is bounded, never an infinite retry.');
      assert.equal(failed.unresolvedPassages,1);
      assert.equal(failed.nodesAdded,0);
      assert.equal((await getCorpus(failedBrain.id)).nodes.length,0,'Truncated content must never enter the graph.');
      globalThis.fetch=async()=>{failedCalls++;throw new DOMException('timeout','TimeoutError');};
      await resumeKnowledgeJob(truncated.id,failedBrain.id,{budgetUsd:.025});
      await stepKnowledgeJob(truncated.id,failedBrain.id);
      const timedOut=await stepKnowledgeJob(truncated.id,failedBrain.id);
      assert.equal(timedOut.stage,'paused-budget');
      assert.equal(failedCalls,4,'Unknown billing is fully reserved, preventing another unsafe paid retry.');
      assert.ok(timedOut.costUsd>0 && timedOut.costUsd<=.025);
      assert.equal(timedOut.measuredCostUsd,.003);
      assert.equal(Math.round((timedOut.estimatedCostUsd+timedOut.measuredCostUsd)*1e8)/1e8,timedOut.costUsd);
      await resumeKnowledgeJob(truncated.id,failedBrain.id,{budgetUsd:.1});
      globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{'}}],usage:{prompt_tokens:100}});
      const partialUsage=await stepKnowledgeJob(truncated.id,failedBrain.id);
      assert.ok(partialUsage.costUsd-timedOut.costUsd>.015,'Partial usage with missing completion tokens must charge the full reserved maximum, not a tiny input-only estimate.');
      const splitBrain=await createBrain('Adaptive split fixture','Test only','Alex');
      await writeRecord(brainKey(splitBrain.id,'corpus.json'),{...main,sources:[source],passages:passages.slice(0,2),warnings:[]});
      const splitJob=await createKnowledgeJob({sourceIds:['book'],budgetUsd:1},splitBrain.id,'Alex');
      globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{'}}],usage:{prompt_tokens:100,completion_tokens:12000,cost:.001}});
      const split=await stepKnowledgeJob(splitJob.id,splitBrain.id);
      assert.equal(split.nodesAdded,0);
      const splitDetail=await getKnowledgeJob(splitJob.id,splitBrain.id);
      assert.equal(splitDetail.batches.length,2,'Truncated multipassage batches become single-passage batches.');
      assert.deepEqual(splitDetail.batches.flatMap(b=>b.passageIds).sort(),passages.slice(0,2).map(p=>p.id).sort(),'Splitting preserves every target exactly once.');
      globalThis.fetch=validFetch;
      for(let i=0;i<6;i++)await stepKnowledgeJob(splitJob.id,splitBrain.id);
      const splitDone=await getKnowledgeJob(splitJob.id,splitBrain.id);
      assert.equal(splitDone.stage,'complete');
      assert.equal(splitDone.nodesAdded,2);
      assert.equal(splitDone.costUsd,.007,'The original truncated call remains included in spending.');
      console.log('PASS: three-worker durable extraction, exact evidence, source isolation, adaptive splitting and hard budget.');
    } finally {
      process.chdir(originalCwd);
      assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'secondbrain-knowledge-'));
      await rm(temp,{recursive:true,force:true});
    }
  `], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
