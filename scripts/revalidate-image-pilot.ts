import assert from "node:assert/strict";
import { brainKey } from "../src/lib/brain-scope";
import { readRecord, updateRecord, writeRecord } from "../src/lib/storage";
import type { KnowledgeJob } from "../src/lib/knowledge";
import type { Corpus } from "../src/lib/types";

async function main() {
  const [brainId, jobId, confirmation] = process.argv.slice(2); assert.equal(confirmation, "--require-image-evidence"); assert.notEqual(brainId, "main");
  const key = brainKey(brainId, `knowledge/jobs/${jobId}.json`), saved = await readRecord<KnowledgeJob>(key); assert.ok(saved); assert.equal(saved.value.stage, "paused"); assert.ok(saved.value.batches.every(b => !b.lease));
  const corpusKey = brainKey(brainId, "corpus.json"), record = await readRecord<Corpus>(corpusKey); assert.ok(record);
  const invalid = record.value.nodes.filter(n => n.extractionJobId === jobId && n.evidence?.some(e => e.sourceId === "astrology-original-page-photographs" && !e.visualObservation));
  assert.ok(invalid.length <= 14, "This bounded repair may only replace the first image pilot, never wider user knowledge.");
  if (!invalid.length) { console.log("Image evidence already revalidated."); return; }
  await writeRecord(brainKey(brainId, `knowledge/history/${jobId}-image-evidence-upgrade.json`), { job: saved.value, nodes: invalid, edges: record.value.edges.filter(e => invalid.some(n => n.id === e.source || n.id === e.target)), commits: record.value.knowledgeCommits });
  const ids = new Set(invalid.map(n => n.id)); let removedNodes = 0, removedEdges = 0;
  await updateRecord(corpusKey, record.value, corpus => {
    const commits = { ...corpus.knowledgeCommits };
    for (const [key, receipt] of Object.entries(commits)) if (key.startsWith(`${jobId}-original-photo-0-`)) { removedNodes += receipt.nodes; removedEdges += receipt.edges; delete commits[key]; }
    return { ...corpus, nodes: corpus.nodes.filter(n => !ids.has(n.id)), edges: corpus.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)), knowledgeCommits: commits };
  });
  await updateRecord(key, saved.value, job => {
    assert.equal(job.stage, "paused"); job.nodesAdded -= removedNodes; job.edgesAdded -= removedEdges;
    const batch = job.batches.find(b => b.id === "original-photo-0")!; batch.phase = "extract"; batch.state = "pending"; batch.revision++; batch.attempts = 0; batch.candidate = undefined; batch.review = undefined;
    for (const audit of job.passages) if (batch.passageIds.includes(audit.passageId)) { audit.disposition = "pending"; audit.nodeIds = []; audit.reason = "Rechecking pilot with mandatory original-image evidence and duplicate review."; }
    job.updatedAt = new Date().toISOString(); job.activity = [...(job.activity ?? []), { at: job.updatedAt, pass: 1, phase: "quality-gate", message: "Archived first image pilot and requeued it under stricter mandatory image-observation and duplicate checks. Original text pilot retained. All billed and uncertain-call safety costs remain counted.", passageIds: batch.passageIds }];
    return job;
  });
  console.log(JSON.stringify({ archivedAndRequeued: invalid.length, originalPilotRetained: saved.value.nodesAdded - removedNodes, allCostsPreserved: saved.value.costUsd }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Image evidence repair failed"); process.exitCode = 1; });
