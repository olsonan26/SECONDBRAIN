import assert from "node:assert/strict";
import { supabaseRead, supabaseWrite } from "../src/lib/supabase-storage";
import { planKnowledgeCuration, curateJob, curationPolicy } from "../src/lib/knowledge-curation";
import { RECOVERED_ASTROLOGY_ID } from "../src/lib/fresh-scan-policy";
import type { Corpus, KnowledgePassageAudit, GraphNode, GraphEdge } from "../src/lib/types";

type Job = { id: string; stage: string; nodesAdded: number; edgesAdded: number; passages: KnowledgePassageAudit[]; costUsd: number; reservedUsd: number; budgetUsd: number; curationApplied?: string[]; batches: { lease?: unknown }[] };
type Archive = { policy: string; brainId: string; jobId: string; archivedAt: string; nodes: GraphNode[]; edges: GraphEdge[]; jobBefore: Job };
async function main() {
  assert.equal(process.env.BRAIN_SUPABASE_URL, "https://gocduruhpoyshixuqhrc.supabase.co");
  const root = `secondbrain/brains/${RECOVERED_ASTROLOGY_ID}/`;
  const jobId = "cfa2d3cb-cc62-479b-8b8e-f19871a7600a";
  const archiveKey = `${root}knowledge/curation/${curationPolicy}.json`;
  const [record, checkpoint, existing] = await Promise.all([supabaseRead<Corpus>(`${root}corpus.json`), supabaseRead<Job>(`${root}knowledge/jobs/${jobId}.json`), supabaseRead<Archive>(archiveKey)]);
  assert.ok(record); assert.ok(checkpoint); assert.equal(checkpoint.value.stage, "paused", "Pause the scan before curation");
  assert.ok(checkpoint.value.batches.every(batch => !batch.lease), "An active model lease must finish before curation");
  const plan = planKnowledgeCuration(record.value);
  const archive: Archive = existing?.value ?? { policy: curationPolicy, brainId: RECOVERED_ASTROLOGY_ID, jobId, archivedAt: new Date().toISOString(), nodes: plan.nodes, edges: plan.edges, jobBefore: checkpoint.value };
  assert.equal(archive.brainId, RECOVERED_ASTROLOGY_ID); assert.equal(archive.jobId, jobId);
  assert.ok(plan.nodes.every(node => archive.nodes.some(saved => saved.id === node.id)), "New unreviewed exclusions require a separate archive");
  if (process.argv.includes("--apply")) {
    if (!existing) {
      await supabaseWrite(archiveKey, archive, null);
      const saved = await supabaseRead<Archive>(archiveKey);
      assert.deepEqual(saved?.value, archive, "Private archive must be readable before graph changes");
    }
    if (plan.nodes.length) await supabaseWrite(`${root}corpus.json`, plan.corpus, record.etag);
    const current = await supabaseRead<Corpus>(`${root}corpus.json`); assert.ok(current);
    assert.ok(archive.nodes.every(node => !current.value.nodes.some(active => active.id === node.id)));
    assert.deepEqual(current.value.sources, record.value.sources); assert.deepEqual(current.value.passages, record.value.passages);
    const updated = curateJob(checkpoint.value, archive.nodes, archive.edges);
    for (const key of ["costUsd", "reservedUsd", "budgetUsd", "batches"] as const) assert.deepEqual(updated[key], checkpoint.value[key]);
    if (updated !== checkpoint.value) await supabaseWrite(`${root}knowledge/jobs/${jobId}.json`, updated, checkpoint.etag);
    const verified = await supabaseRead<Job>(`${root}knowledge/jobs/${jobId}.json`);
    assert.deepEqual(verified?.value, updated);
  }
  console.log(JSON.stringify({ applied: process.argv.includes("--apply"), archivedNodes: archive.nodes.length, removedNow: plan.nodes.length, sources: record.value.sources.length, passages: record.value.passages.length, activeNodes: plan.corpus.nodes.length, spendingPreserved: checkpoint.value.costUsd, budgetPreserved: checkpoint.value.budgetUsd, paidCallsStarted: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Knowledge curation failed"); process.exitCode = 1; });
