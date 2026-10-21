import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createKnowledgeJob, getKnowledgeJob, stepKnowledgeJob, pauseKnowledgeJob } from "../src/lib/knowledge";
import { getCorpus } from "../src/lib/corpus";
import { readRecord, updateRecord } from "../src/lib/storage";
import { brainKey } from "../src/lib/brain-scope";
import { saveQuestionProfile } from "../src/lib/knowledge-question-profile";

async function main() {
  const [brainId, sourceId, confirm, ...files] = process.argv.slice(2);
  assert.ok(brainId && sourceId && confirm === "--run", "Usage: run-book-pilot.ts BRAIN SOURCE --run REQUIREMENTS...");
  assert.notEqual(brainId, "main");
  const requirements = (await Promise.all(files.map(file => readFile(file, "utf8")))).join("\n\n");
  const corpus = await getCorpus(brainId);
  assert.ok(corpus.sources.some(source => source.id === sourceId));
  const job = await createKnowledgeJob({ sourceIds: [sourceId], budgetUsd: 10, requirements }, brainId, "Alex");
  await saveQuestionProfile(requirements, job.id, brainId);
  const key = brainKey(brainId, `knowledge/jobs/${job.id}.json`);
  type OrderedJob = { batches: { passageIds: string[] }[] };
  const stored = await readRecord<OrderedJob>(key);
  assert.ok(stored);
  // Reorder whole batches only. Nothing is omitted, shortened or marked done.
  const score = (batch: OrderedJob["batches"][number]) => batch.passageIds.some(id => {
    const passage = corpus.passages.find(p => p.id === id);
    return passage && /ORDER OF ASSESSMENT[\s.·]*103/i.test(passage.text);
  }) ? 1 : 0;
  await updateRecord(key, stored.value, current => ({ ...current, batches: [...current.batches].sort((a, b) => score(b) - score(a)) }));
  console.log(JSON.stringify({ event: "pilot-created", id: job.id, brainId, sourceId, totalPassages: job.totalPassages, budgetUsd: job.budgetUsd }));
  try {
    for (let call = 0; call < 3; call++) {
      const progress = await stepKnowledgeJob(job.id, brainId);
      console.log(JSON.stringify({ event: "pilot-step", call: call + 1, stage: progress.stage, nodes: progress.nodesAdded, reviewed: progress.reviewedPassages, measuredCostUsd: progress.measuredCostUsd, safetySpendUsd: progress.costUsd, error: progress.error }));
      if (["failed", "paused", "paused-budget", "needs-review", "complete"].includes(progress.stage)) break;
    }
  } finally { await pauseKnowledgeJob(job.id, brainId); }
  const saved = await getKnowledgeJob(job.id, brainId);
  console.log(JSON.stringify({ event: "pilot-saved", id: job.id, stage: saved.stage, nodes: saved.nodesAdded, reviewed: saved.reviewedPassages, unresolved: saved.unresolvedPassages, safetySpendUsd: saved.costUsd, batches: saved.batches.filter(batch => batch.state === "done" || batch.attempts > 0) }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Pilot failed"); process.exitCode = 1; });
