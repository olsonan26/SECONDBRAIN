import assert from "node:assert/strict";
import { brainKey } from "../src/lib/brain-scope";
import { readRecord, updateRecord, writeRecord } from "../src/lib/storage";
import { requiresVisualStructureReview } from "../src/lib/knowledge-schema";
import type { KnowledgeJob } from "../src/lib/knowledge";
import type { Corpus } from "../src/lib/types";

async function main() {
  const [brain, id] = process.argv.slice(2); assert.ok(brain && id); assert.notEqual(brain, "main");
  const key = brainKey(brain, `knowledge/jobs/${id}.json`), job = await readRecord<KnowledgeJob>(key); assert.ok(job); assert.equal(job.value.stage, "paused"); assert.ok(job.value.batches.every(b => !b.lease));
  const corpusKey = brainKey(brain, "corpus.json"), saved = await readRecord<Corpus>(corpusKey); assert.ok(saved);
  const nodes = saved.value.nodes.filter(n => n.extractionJobId === id && requiresVisualStructureReview(n)); assert.ok(nodes.length <= 2, "Only the two newly tested structural diagram mappings may be quarantined.");
  if (!nodes.length) return;
  const ids = new Set(nodes.map(n => n.id)), passageIds = new Set(nodes.flatMap(n => n.evidence?.map(e => e.passageId) ?? []));
  const edges = saved.value.edges.filter(e => ids.has(e.source) || ids.has(e.target));
  await writeRecord(brainKey(brain, `knowledge/review/${id}-diagram-pilot.json`), { nodes, edges, reason: "Independent visual inspection caught incorrect glyph mappings. Not accepted as verified knowledge." });
  const reason = "Small chart glyph positions require separate visual verification. Candidates and original image retained in the private review archive; no guessed diagram mappings published.";
  await updateRecord(corpusKey, saved.value, corpus => {
    for (const receipt of Object.values(corpus.knowledgeCommits ?? {})) if (receipt.audits?.some(a => passageIds.has(a.passageId))) {
      receipt.nodes -= nodes.length; receipt.edges = Math.max(0, receipt.edges - edges.length);
      for (const audit of receipt.audits) if (passageIds.has(audit.passageId)) { audit.nodeIds = audit.nodeIds.filter(n => !ids.has(n)); audit.disposition = "unresolved"; audit.reason = reason; }
    }
    return { ...corpus, nodes: corpus.nodes.filter(n => !ids.has(n.id)), edges: corpus.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)) };
  });
  await updateRecord(key, job.value, current => {
    current.nodesAdded -= nodes.length; current.edgesAdded = Math.max(0, current.edgesAdded - edges.length);
    for (const audit of current.passages) if (passageIds.has(audit.passageId)) { audit.nodeIds = audit.nodeIds.filter(n => !ids.has(n)); audit.disposition = "unresolved"; audit.reason = reason; }
    current.warnings = [...new Set([...current.warnings, reason])]; current.updatedAt = new Date().toISOString(); return current;
  });
  console.log(JSON.stringify({ quarantinedDiagramMappings: nodes.length, retainedTeachingNodes: saved.value.nodes.filter(n => n.type === "teaching").length - nodes.length, costUnchanged: job.value.costUsd }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Diagram review failed"); process.exitCode = 1; });
