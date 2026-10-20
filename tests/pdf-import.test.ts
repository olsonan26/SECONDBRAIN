import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("a book-length PDF under the upload limit imports every page, remains searchable, and stays isolated", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import path from 'node:path';
    import os from 'node:os';
    process.env.BLOB_READ_WRITE_TOKEN=''; process.env.BLOB_STORE_ID=''; delete process.env.VERCEL;
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {textPdf}=await load('./tests/fixtures/pdf.ts');
    const {importFile}=await load('./src/lib/import.ts');
    const {getCorpus}=await load('./src/lib/corpus.ts');
    const {readOriginal}=await load('./src/lib/storage.ts');
    const {retrieve}=await load('./src/lib/search.ts');
    const originalCwd=process.cwd();
    const temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-pdf-'));
    process.chdir(temp);
    try {
      const id='a2f66ffe-ae02-40eb-a264-a5697dcb6c5b';
      const bytes=textPdf(); assert.ok(bytes.length<4_000_000);
      const imported=await importFile(new File([bytes],'Astrology book.pdf'),id);
      assert.equal(imported.source.pages,692); assert.ok(imported.source.characters>1_000_000);
      const corpus=await getCorpus(id);
      assert.equal(corpus.sources.length,1);
      assert.ok(corpus.passages.some(p=>p.page===1));
      assert.ok(corpus.passages.some(p=>p.page===692),'Final page must not be truncated');
      assert.ok(retrieve(corpus,'planets signs houses').length>0);
      assert.deepEqual(Buffer.from(await readOriginal(imported.source.id,'pdf',id)),bytes);
      assert.equal((await getCorpus('main')).sources.length,0);
      await assert.rejects(()=>importFile(new File([bytes],'Astrology book.pdf'),id),/already in/);
      console.log('PASS: 692 pages, full text, retrieval, original bytes, isolation and duplicate protection.');
    } finally {
      process.chdir(originalCwd);
      assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'secondbrain-pdf-'));
      await rm(temp,{recursive:true,force:true});
    }
  `], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
