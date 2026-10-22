import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { supabaseRead } from "../src/lib/supabase-storage";
import { RECOVERED_ASTROLOGY_ID } from "../src/lib/fresh-scan-policy";
import { nonTeachingNodeReason } from "../src/lib/knowledge-usefulness";
import type { Corpus } from "../src/lib/types";
import type { KnowledgeJob } from "../src/lib/knowledge";

// Read-only cloud audit. Generated source-bearing snapshots are ignored/private.
async function main() {
  const root = `secondbrain/brains/${RECOVERED_ASTROLOGY_ID}/`;
  const jobKey = `${root}knowledge/jobs/cfa2d3cb-cc62-479b-8b8e-f19871a7600a.json`;
  const [corpus, job] = await Promise.all([supabaseRead<Corpus>(`${root}corpus.json`), supabaseRead<KnowledgeJob>(jobKey)]);
  assert.ok(corpus && job);
  await mkdir("private/quality-audit", { recursive: true });
  await writeFile("private/quality-audit/corpus.json", JSON.stringify(corpus.value));
  await writeFile("private/quality-audit/job.json", JSON.stringify(job.value));
  const teachings = corpus.value.nodes.filter(node => node.type === "teaching");
  const grouped = new Map<string, typeof teachings>();
  for (const node of teachings) for (const id of new Set(node.evidence?.map(e => e.passageId) ?? [])) grouped.set(id, [...(grouped.get(id) ?? []), node]);
  const pages = [...grouped].map(([id, nodes]) => {
    const passage = corpus.value.passages.find(p => p.id === id);
    return { id, image: passage?.image?.driveId, filename: passage?.image?.filename, labels: nodes.map(n => n.label), count: nodes.length };
  });
  await writeFile("private/quality-audit/pages.json", JSON.stringify(pages, null, 2));
  console.log(JSON.stringify({ stage: job.value.stage, pass: job.value.scanPass ?? 1, processed: job.value.passages.filter(p => p.disposition !== "pending").length, total: job.value.passages.length, nodes: teachings.length, costUsd: job.value.costUsd, measuredUsd: job.value.measuredCostUsd, estimatedUsd: job.value.estimatedCostUsd, cap: job.value.budgetUsd, unresolved: job.value.passages.filter(p => p.disposition === "unresolved").length, activeLeases: job.value.batches.filter(b => b.lease).length, obviousNonteaching: teachings.filter(nonTeachingNodeReason).map(n => ({ id: n.id, label: n.label })), pages: pages.length, paidCallsStarted: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Read-only quality snapshot failed"); process.exitCode = 1; });
