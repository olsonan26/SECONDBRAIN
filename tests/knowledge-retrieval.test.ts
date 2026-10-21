import test from "node:test";
import assert from "node:assert/strict";
import { retrieveWithKnowledge } from "../src/lib/knowledge-retrieval";
import type { Corpus } from "../src/lib/types";

const passage = { id: "p1", sourceId: "s1", sourceTitle: "Study", page: 12, section: "A method", lineStart: 1, lineEnd: 2, text: "A documented symbolic interpretation of emotional themes is described here." };
const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", warnings: [], sources: [], passages: [passage], edges: [], nodes: [{ id: "n1", label: "Emotional interpretation", type: "teaching", layer: "uploaded", community: "Emotions", sourceIds: ["s1"], description: "A teaching about emotional themes.", degree: 0, aliases: ["sensitivity"], evidence: [{ passageId: "p1", sourceId: "s1", page: 12, quote: "symbolic interpretation of emotional themes" }], ...{ applicationTags: ["emotions"] } }] };
test("graph aliases and application routing return original source passages, not model-generated descriptions", () => {
  const aliases = retrieveWithKnowledge(corpus, "sensitivity");
  assert.equal(aliases[0].text, passage.text); assert.equal(aliases[0].page, 12);
  const routed = retrieveWithKnowledge(corpus, "Why do I feel overwhelmed?", [], ["emotions"]);
  assert.equal(routed[0].id, "p1");
  assert.deepEqual(retrieveWithKnowledge(corpus, "sensitivity", ["other"]), []);
});
test("unrelated questions and fabricated graph evidence cannot become source citations", () => {
  assert.deepEqual(retrieveWithKnowledge(corpus, "industrial railway engineering"), []);
  const forged = { ...corpus, nodes: corpus.nodes.map(n => ({ ...n, evidence: [{ passageId: "p1", sourceId: "s1", page: 12, quote: "invented quote" }] })) };
  assert.deepEqual(retrieveWithKnowledge(forged, "sensitivity"), []);
});
