import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { retrieve } from "../src/lib/search";
import type { Corpus, Citation } from "../src/lib/types";
import { validateGroundedOutput, allParagraphsSupported } from "../src/lib/grounding";

const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", nodes: [], edges: [], warnings: [], sources: [], passages: [
  { id: "p1", sourceId: "s1", sourceTitle: "Personal year notes", page: 7, section: "Personal year 7", lineStart: 22, lineEnd: 24, text: "Personal year 7 is described in these notes as a period of reflection and study. The chapter discusses reflection and time for learning." },
  { id: "p2", sourceId: "s2", sourceTitle: "Business planning", page: null, section: "Annual planning", lineStart: 4, lineEnd: 7, text: "Business planning needs a yearly plan with clear priorities. A yearly plan can help align a team and structure its business decisions." },
] };
test("retrieves a relevant passage with its original source and location", () => {
  const hits = retrieve(corpus, "What do the notes say about personal year 7?");
  assert.ok(hits.length > 0); assert.equal(hits[0].sourceId, "s1"); assert.equal(hits[0].page, 7);
});
test("does not manufacture results for absent concepts", () => {
  assert.deepEqual(retrieve(corpus, "How do quantum superconductors cure allergies?"), []);
});
test("respects a selected source boundary", () => {
  const hits = retrieve(corpus, "business planning", ["s1"]); assert.deepEqual(hits, []);
});
test("can find a document by title even when those words are absent from its body", () => {
  const data = { ...corpus, passages: [{ ...corpus.passages[0], sourceTitle: "Celestial compass", section: "Introduction" }] };
  assert.equal(retrieve(data, "Celestial compass")[0]?.sourceId, "s1");
});
test("an oversized candidate cannot suppress shorter valid passages", () => {
  const data = { ...corpus, passages: [{ ...corpus.passages[0], id: "long", text: "personal year reflection ".repeat(1500) }, corpus.passages[0]] };
  assert.ok(retrieve(data, "personal year reflection").some(p => p.id === "p1"));
});
test("the independent support check must accept every paragraph exactly once", () => {
  assert.equal(allParagraphsSupported([{index:0,supported:true},{index:1,supported:true}],2),true);
  assert.equal(allParagraphsSupported([{index:0,supported:true},{index:1,supported:false}],2),false);
  assert.equal(allParagraphsSupported([{index:0,supported:true},{index:0,supported:true}],2),false);
  assert.equal(allParagraphsSupported([],1),false);
});
test("requires traceable citations and verbatim evidence for model paragraphs", () => {
  const citations = [{ ...corpus.passages[0], number: 1, score: 3 }] as Citation[];
  const good = { paragraphs: [{ text: "The notes frame this period around reflection.", citations: [1], evidence: [{ citation: 1, quote: "a period of reflection and study" }] }] };
  assert.equal(validateGroundedOutput(good, citations), true);
  assert.equal(validateGroundedOutput({ paragraphs: [{ ...good.paragraphs[0], citations: [99] }] }, citations), false);
  assert.equal(validateGroundedOutput({ paragraphs: [{ ...good.paragraphs[0], evidence: [{ citation: 1, quote: "This evidence never appeared in the source" }] }] }, citations), false);
  assert.equal(validateGroundedOutput({ paragraphs: [{ ...good.paragraphs[0], citations: [] }] }, citations), false);
});
test("recovered private library returns exact passages and all graph sources resolve", { skip: !existsSync("private/corpus.json") }, () => {
  const data = JSON.parse(readFileSync("private/corpus.json", "utf8")) as Corpus;
  assert.equal(data.sources.length, 74); assert.equal(data.nodes.length, 565);
  for(const q of ["personal year", "life path", "numerology", "archetype"]) {
    const hits = retrieve(data, q); assert.ok(hits.length > 0, `Missing real retrieval for ${q}`);
    for(const hit of hits) assert.ok(data.sources.find(s => s.id === hit.sourceId)?.content?.includes(hit.text));
  }
  for(const e of data.edges) for(const id of e.sourceIds) assert.ok(data.sources.some(s=>s.id===id));
});
