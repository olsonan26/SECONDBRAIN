import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeOverview, knowledgeNodeDetail, searchKnowledgeNodes } from "../src/lib/knowledge-graph";
import type { Corpus } from "../src/lib/types";
const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", warnings: [], sources: [], passages: [], edges: [], nodes: Array.from({ length: 2305 }, (_, i) => ({ id: `n${i}`, label: i === 2304 ? "A rare exact method" : `Teaching ${i}`, type: "teaching", layer: "uploaded", community: "Study", sourceIds: [], description: "A fully preserved teaching. ".repeat(80), degree: 0 })) };
test("server graph overview is bounded but all nodes remain searchable and retrievable", () => {
  const view = knowledgeOverview(corpus);
  assert.ok(view.nodes.length > 0 && view.nodes.length <= 1800); assert.equal(view.graphOverviewOnly, true);
  assert.ok(view.nodes.every(n => n.description.length <= 700));
  assert.equal(corpus.nodes.length, 2305);
  const result = searchKnowledgeNodes(corpus, "rare exact");
  assert.equal(result.total, 1); assert.equal(result.nodes[0].id, "n2304");
  assert.equal(knowledgeNodeDetail(corpus, "n2304")?.node.description, corpus.nodes[2304].description);
  assert.equal(knowledgeNodeDetail(corpus, "absent"), null);
  assert.equal(searchKnowledgeNodes(corpus, "", 100, 50).nodes.length, 50);
});
test("even graphs below the drawing threshold use bounded bootstrap payloads", () => {
  const small = { ...corpus, nodes: corpus.nodes.slice(0, 1200).map(n => ({ ...n, description: "Teaching ".repeat(400), evidence: Array.from({ length: 2 }, () => ({ passageId: "p", sourceId: "s", page: 1, quote: "Quoted text ".repeat(150) })) })) };
  const view = knowledgeOverview(small);
  assert.ok(Buffer.byteLength(JSON.stringify(view)) < 2_100_000);
  assert.equal(view.graphOverviewOnly, true);
  assert.equal(knowledgeNodeDetail(small, small.nodes[0].id)?.node.description, small.nodes[0].description);
});
