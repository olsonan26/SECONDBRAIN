import test from "node:test";
import assert from "node:assert/strict";
import { planKnowledgeCuration, curateJob } from "../src/lib/knowledge-curation";
import type { Corpus, GraphNode } from "../src/lib/types";

test("curation archives only definite commentary, retains real knowledge and source text, and never resets spending", () => {
  const node = (id: string, label: string, type = "teaching"): GraphNode => ({ id, label, type, description: label, layer: "uploaded", community: "Test", sourceIds: ["book"], degree: 2 });
  const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [], nodes: [node("source", "Book", "document"), node("noise", "Work is titled Alchemystic Astrology"), node("rule", "PHSR assessment order")], edges: [{ id: "noise-edge", source: "source", target: "noise", relation: "contains", confidence: "EXTRACTED", score: 1, sourceIds: ["book"] }, { id: "real-edge", source: "source", target: "rule", relation: "contains", confidence: "EXTRACTED", score: 1, sourceIds: ["book"] }], warnings: [] };
  const plan = planKnowledgeCuration(corpus);
  assert.deepEqual(plan.nodes.map(node => node.id), ["noise"]);
  assert.deepEqual(plan.corpus.nodes.map(node => node.id), ["source", "rule"]);
  assert.equal(plan.corpus.sources, corpus.sources); assert.equal(plan.corpus.passages, corpus.passages);
  assert.equal(corpus.nodes.length, 3, "Original archive input must remain intact");
  const job = { nodesAdded: 2, edgesAdded: 2, stage: "paused", costUsd: 0.02666307, reservedUsd: 0, budgetUsd: 10, batches: [{ phase: "review" }], passages: [{ passageId: "p", sourceId: "book", page: 1, disposition: "extracted" as const, reason: "Supported", nodeIds: ["noise"] }] };
  const updated = curateJob({ ...job, curationApplied: ["useful-teachings-v1"] }, plan.nodes, plan.edges);
  assert.equal(updated.nodesAdded, 1); assert.equal(updated.passages[0].disposition, "excluded-noise");
  for (const key of ["stage", "costUsd", "reservedUsd", "budgetUsd", "batches"] as const) assert.deepEqual(updated[key], job[key]);
  assert.deepEqual(curateJob(updated, plan.nodes, plan.edges), updated, "Repair must be idempotent");
});
