import assert from "node:assert/strict";
import { getKnowledgeJob, resumeKnowledgeJob, stepKnowledgeJob, pauseKnowledgeJob } from "../src/lib/knowledge";
import { getCorpus, invalidateCorpus } from "../src/lib/corpus";

async function main() {
  const [brainId, jobId, action] = process.argv.slice(2);
  assert.ok(brainId && jobId);
  if (action === "--one-step") {
    await resumeKnowledgeJob(jobId, brainId);
    try { await stepKnowledgeJob(jobId, brainId); }
    finally { await pauseKnowledgeJob(jobId, brainId); }
  }
  const job = await getKnowledgeJob(jobId, brainId);
  invalidateCorpus(brainId);
  const corpus = await getCorpus(brainId);
  const nodes = corpus.nodes.filter(node => node.extractionJobId === jobId);
  console.log(JSON.stringify({ id: jobId, stage: job.stage, reviewed: job.reviewedPassages, nodes: job.nodesAdded, safetySpendUsd: job.costUsd, measuredCostUsd: job.measuredCostUsd, error: job.error, activeBatches: job.batches.filter(batch => batch.phase !== "extract" || batch.attempts > 0 || batch.state === "done"), sample: nodes.slice(0, 12).map(node => ({ id: node.id, label: node.label, description: node.description, evidence: node.evidence })) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Pilot inspection failed"); process.exitCode = 1; });
