import assert from "node:assert/strict";
import { getKnowledgeJob, resumeKnowledgeJob, stepKnowledgeJob, pauseKnowledgeJob, knowledgeActivity } from "../src/lib/knowledge";
import { getCorpus, invalidateCorpus } from "../src/lib/corpus";
import { readRecord, updateRecord } from "../src/lib/storage";
import { brainKey } from "../src/lib/brain-scope";
import type { KnowledgeJob } from "../src/lib/knowledge";

async function main() {
  const [brainId, jobId, mode] = process.argv.slice(2); assert.ok(brainId && jobId);
  const initial = await getKnowledgeJob(jobId, brainId);
  assert.equal(initial.budgetUsd, 10); assert.equal(initial.imagePassages, 1028);
  if (mode === "--diagram") {
    assert.equal(initial.stage, "paused");
    const corpus = await getCorpus(brainId), passage = corpus.passages.find(p => p.image?.driveId === "11RBOMmi9oSIqZn3prTEKwCNfUsT_PvyA"); assert.ok(passage);
    const key = brainKey(brainId, `knowledge/jobs/${jobId}.json`), record = await readRecord<KnowledgeJob>(key); assert.ok(record);
    await updateRecord(key, record.value, job => {
      assert.ok(job.batches.every(b => !b.lease));
      const index = job.batches.findIndex(b => b.passageIds.includes(passage.id)); assert.ok(index >= 0); assert.equal(job.batches[index].state, "pending");
      job.batches.unshift(...job.batches.splice(index, 1)); return job;
    });
  }
  await resumeKnowledgeJob(jobId, brainId);
  try {
    for (let count = 0; count < 7; count++) {
      const result = await stepKnowledgeJob(jobId, brainId);
      console.log(JSON.stringify({ step: count + 1, reviewed: result.reviewedPassages, nodes: result.nodesAdded, costUsd: result.costUsd, stage: result.stage, error: result.error }));
      if (result.reviewedPassages >= initial.reviewedPassages + 1 || !["running", "queued"].includes(result.stage) || result.costUsd > initial.costUsd + 0.3) break;
    }
  } finally { await pauseKnowledgeJob(jobId, brainId); }
  invalidateCorpus(brainId);
  const corpus = await getCorpus(brainId), job = await getKnowledgeJob(jobId, brainId), activity = await knowledgeActivity(jobId, brainId);
  const nodes = corpus.nodes.filter(n => n.evidence?.some(e => e.imageId));
  console.log(JSON.stringify({ stage: job.stage, totalNodes: corpus.nodes.length, teachings: corpus.nodes.filter(n => n.type === "teaching").length, originalImages: job.imagePassages, reviewedImages: job.reviewedImages, costUsd: job.costUsd, imageCalls: activity.events.filter(e => e.phase === "image-input").map(e => e.message), visualTeachings: nodes.map(n => ({ label: n.label, text: n.description, evidence: n.evidence })) }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Image verification failed"); process.exitCode = 1; });
