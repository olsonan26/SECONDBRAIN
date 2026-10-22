import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeNavigation } from "../src/lib/knowledge-context";
import type { Corpus, Passage } from "../src/lib/types";

const passage: Passage = { id: "p1", sourceId: "book", sourceTitle: "Book", page: 1, section: "Timing", lineStart: 1, lineEnd: 1, text: "Activation timing rule and its exact conditions." };
const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [passage], edges: [], warnings: [], nodes: Array.from({ length: 600 }, (_, i) => ({ id: "n" + i, label: "Activation timing rule " + i, type: "teaching", layer: "uploaded", community: "Timing", sourceIds: ["book"], degree: 0, description: "Exact rule " + i + ": " + "Preserve this condition, number and exception. ".repeat(23) })) };

test("graph-navigation overhead is fixed, final-only and does not clip technical claims", () => {
  const before = JSON.stringify(corpus);
  const originalPerCall = Buffer.byteLength(JSON.stringify({ nodes: corpus.nodes.slice(0, 60).map(node => ({ id: node.id, label: node.label, teaching: node.description.slice(0, 1200) })), relationships: [] }));
  const navigation = ["extract", "review", "verify"].map(phase => knowledgeNavigation(corpus, [passage], phase as "extract" | "review" | "verify"));
  assert.deepEqual(navigation.slice(0, 2).map(value => value.nodes.length), [0, 0]);
  assert.ok(navigation[2].nodes.length > 0);
  for (const node of navigation[2].nodes) assert.equal(node.teaching, corpus.nodes.find(original => original.id === node.id)?.description);
  const bytes = navigation.map(value => Buffer.byteLength(JSON.stringify(value)));
  assert.ok(bytes.every(size => size <= 6000));
  assert.ok(bytes.reduce((a, b) => a + b, 0) < originalPerCall * 3 * .05, "Repeated graph-navigation bytes fall by over 95% in this growing-graph fixture, not a claim about total provider billing.");
  assert.equal(JSON.stringify(corpus), before, "Never shrink the stored graph or original source to reduce prompts.");
  console.log(JSON.stringify({ navigationFixture: { previousThreeCallsBytes: originalPerCall * 3, optimizedThreeCallsBytes: bytes.reduce((a, b) => a + b, 0) } }));
});

test("navigation counts UTF-8 bytes and never converts a bounded index into a completeness claim", () => {
  const large = { ...corpus, nodes: [{ ...corpus.nodes[0], id: "huge", description: "漢".repeat(3500) }, { ...corpus.nodes[1], id: "small", description: "A complete conditional teaching that fits without truncation." }] };
  const navigation = knowledgeNavigation(large, [passage], "verify");
  assert.equal(navigation.nodes.some(node => node.id === "huge"), false);
  assert.equal(navigation.nodes.some(node => node.id === "small"), true);
  assert.equal(navigation.limited, true);
  assert.ok(Buffer.byteLength(JSON.stringify(navigation)) <= 6000);
});
