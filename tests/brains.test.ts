import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { brainKey, validBrainId } from "../src/lib/brain-scope";

test("brain storage preserves legacy paths and rejects path traversal", () => {
  const id = "c0bb1f5b-d146-4780-9654-b89f481412ba";
  assert.equal(brainKey("main", "corpus.json"), "corpus.json");
  assert.equal(brainKey(id, "drafts/test.json"), `brains/${id}/drafts/test.json`);
  for (const invalid of ["", "../main", "main/other", "unknown", "../../settings.json"]) {
    assert.equal(validBrainId(invalid), false);
    assert.throws(() => brainKey(invalid, "corpus.json"));
  }
  assert.throws(() => brainKey(id, "../corpus.json"));
});

test("real imports, original files, cached corpora, answers, drafts and workflows remain isolated", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import path from 'node:path';
    import os from 'node:os';
    process.env.BLOB_READ_WRITE_TOKEN=''; process.env.BLOB_STORE_ID=''; delete process.env.VERCEL;
    process.env.OPENROUTER_API_KEY=''; process.env.DEEPSEEK_API_KEY='';
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {createBrain,listBrains,requireBrain}=await load('./src/lib/brains.ts');
    const {getCorpus}=await load('./src/lib/corpus.ts');
    const {importFile}=await load('./src/lib/import.ts');
    const {workspace,ask,createDraft,runWorkflow}=await load('./src/lib/workspace.ts');
    const {readOriginal}=await load('./src/lib/storage.ts');
    const originalCwd=process.cwd();
    const temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-isolation-'));
    process.chdir(temp);
    try {
      const owner={name:'Alex',role:'owner'};
      assert.equal((await listBrains()).length,1);
      const mainText='Annual planning focuses on team priorities and thoughtful business decisions. Annual planning keeps a business focused on clear goals.';
      await importFile(new File([mainText],'Business notes.txt'));
      const mainBefore=JSON.stringify(await getCorpus('main'));
      const astrology=await createBrain('Astrology','Planets and zodiac signs','Alex');
      const business=await createBrain('Research','Another independent library','Alex');
      await assert.rejects(()=>createBrain(' astrology ','Duplicate','Alex'),/already exists/);
      await assert.rejects(()=>requireBrain('a96ac723-d66d-4c24-a1da-a1d64d789eb5'),/does not exist/);
      assert.equal((await getCorpus(astrology.id)).sources.length,0);
      assert.equal((await ask('annual planning',[],astrology.id)).mode,'not-found');
      await assert.rejects(()=>createDraft('annual planning',undefined,[],'Alex',astrology.id),/No supporting passages/);
      const astroText='Zodiac signs and astrology describe symbolic interpretations of planetary themes. Zodiac signs organize the astrology notes in this test fixture.';
      const uploaded=await importFile(new File([astroText],'Astrology notes.txt'),astrology.id);
      assert.equal((await getCorpus(astrology.id)).sources.length,1);
      assert.equal(JSON.stringify(await getCorpus('main')),mainBefore,'Astrology upload changed the main corpus or its cache');
      assert.equal((await ask('zodiac signs',[],astrology.id)).mode,'extractive');
      assert.equal((await ask('zodiac signs',[],'main')).mode,'not-found');
      assert.equal((await ask('annual planning',[],astrology.id)).mode,'not-found');
      assert.ok(await readOriginal(uploaded.source.id,'txt',astrology.id));
      assert.equal(await readOriginal(uploaded.source.id,'txt','main'),null);
      assert.equal(await readOriginal(uploaded.source.id,'txt',business.id),null);
      await importFile(new File([astroText],'Astrology notes.txt'),business.id);
      assert.equal((await getCorpus(business.id)).sources.length,1,'Deduplication accidentally spans brains');
      await assert.rejects(()=>importFile(new File([astroText],'Astrology notes.txt'),astrology.id),/already in/);
      await importFile(new File([JSON.stringify({nodes:[{id:'sun',label:'Sun',source_file:'Astrology notes.txt'}],links:[]})],'graph.json'),astrology.id);
      assert.equal((await getCorpus(astrology.id)).nodes.length,2);
      assert.equal((await getCorpus(business.id)).nodes.length,1);
      await createDraft('zodiac signs',undefined,[],'Alex',astrology.id);
      await runWorkflow('knowledge-audit','',[],'Alex',astrology.id);
      const main=await workspace(owner,'main');
      const astro=await workspace(owner,astrology.id);
      const other=await workspace({name:'Peter',role:'member'},business.id);
      assert.equal(main.drafts.length,0); assert.equal(main.runs.length,0);
      assert.equal(astro.drafts.length,1); assert.equal(astro.runs.length,1);
      assert.equal(other.drafts.length,0); assert.equal(other.runs.length,0);
      assert.equal(astro.brain.id,astrology.id); assert.equal(astro.brains.length,3);
      assert.equal(JSON.stringify(await getCorpus('main')),mainBefore);
      console.log('PASS: all real brain data paths are isolated; legacy data is unchanged.');
    } finally {
      process.chdir(originalCwd);
      assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'secondbrain-isolation-'));
      await rm(temp,{recursive:true,force:true});
    }
  `], { encoding: "utf8", timeout: 40_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
