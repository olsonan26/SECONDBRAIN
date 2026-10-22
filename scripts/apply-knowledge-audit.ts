import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { supabaseRead, supabaseWrite } from "../src/lib/supabase-storage";
import { RECOVERED_ASTROLOGY_ID } from "../src/lib/fresh-scan-policy";
import { auditHash, planQualityAudit, settleQualityAudit, type QualityAuditManifest } from "../src/lib/knowledge-audit";
import type { Corpus, Passage } from "../src/lib/types";
import type { KnowledgeJob } from "../src/lib/knowledge";

async function main() {
  assert.equal(process.env.BRAIN_SUPABASE_URL, "https://gocduruhpoyshixuqhrc.supabase.co");
  assert.ok(process.argv[2], "Supply an explicitly reviewed private manifest; default is preview only");
  const manifest: QualityAuditManifest = JSON.parse(await readFile(process.argv[2], "utf8"));
  const root = `secondbrain/brains/${RECOVERED_ASTROLOGY_ID}/`, corpusKey = `${root}corpus.json`, jobKey = `${root}knowledge/jobs/${manifest.jobId}.json`, archiveKey = `${root}knowledge/quality-audits/${manifest.id}.json`;
  const [record, checkpoint, archived] = await Promise.all([supabaseRead<Corpus>(corpusKey), supabaseRead<KnowledgeJob>(jobKey), supabaseRead<{ manifestHash: string }>(archiveKey)]);
  assert.ok(record && checkpoint); assert.equal(checkpoint.value.brainId, RECOVERED_ASTROLOGY_ID);
  for (const image of manifest.reviewedImages) {
    const passage: Passage | undefined = record.value.passages.find(p => p.id === image.passageId); assert.ok(passage?.image);
    const bytes: Buffer = await readFile(`private/astrology-photos/${passage.image.driveId}.jpg`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), image.sha256, "Local reviewed photo does not match cloud source");
  }
  const plan = planQualityAudit(record.value, checkpoint.value, manifest);
  const output = { auditId: manifest.id, apply: process.argv.includes("--apply"), nodeDelta: plan.receipt.nodeDelta, edgeDelta: plan.receipt.edgeDelta, reviewedPages: manifest.reviewedImages.length, affectedPages: plan.receipt.passageIds.length, decisions: manifest.decisions.length, additions: manifest.additions.length, costUsd: checkpoint.value.costUsd, budgetUsd: checkpoint.value.budgetUsd, paidCallsStarted: 0 };
  if (!process.argv.includes("--apply")) { console.log(JSON.stringify(output)); return; }
  if (checkpoint.value.qualityAuditsApplied?.includes(manifest.id)) { assert.equal(plan.receipt.manifestHash, auditHash(manifest)); console.log(JSON.stringify({ ...output, alreadyApplied: true })); return; }
  if (archived) assert.equal(archived.value.manifestHash, auditHash(manifest));
  assert.ok(!checkpoint.value.qualityAuditLock || checkpoint.value.qualityAuditLock === manifest.id, "Another audit owns the checkpoint");
  if (!checkpoint.value.qualityAuditLock) await supabaseWrite(jobKey, { ...checkpoint.value, qualityAuditLock: manifest.id }, checkpoint.etag);
  if (!archived) {
    assert.ok(!record.value.qualityAuditReceipts?.[manifest.id], "Recovery requires the original archive");
    await supabaseWrite(archiveKey, { manifestHash: auditHash(manifest), manifest, beforeNodes: plan.beforeNodes, beforeEdges: plan.beforeEdges, jobBefore: checkpoint.value, receipt: plan.receipt, archivedAt: new Date().toISOString() }, null);
  }
  const backup = await supabaseRead<{ manifestHash: string }>(archiveKey); assert.equal(backup?.value.manifestHash, auditHash(manifest), "Archive must be readable before changing nodes");
  if (!record.value.qualityAuditReceipts?.[manifest.id]) await supabaseWrite(corpusKey, plan.corpus, record.etag);
  const [corpus, lockedJob] = await Promise.all([supabaseRead<Corpus>(corpusKey), supabaseRead<KnowledgeJob>(jobKey)]); assert.ok(corpus && lockedJob);
  assert.equal(lockedJob.value.qualityAuditLock, manifest.id);
  assert.deepEqual(corpus.value.sources, record.value.sources); assert.deepEqual(corpus.value.passages, record.value.passages);
  const updated = settleQualityAudit(lockedJob.value, corpus.value, manifest);
  updated.updatedAt = new Date().toISOString();
  updated.activity = [...(updated.activity ?? []), { at: updated.updatedAt, pass: updated.scanPass ?? 1, phase: "operator-audit", message: "Source-photo sample audit applied explicit corrections, holds, consolidations and verified additions. Originals, prior spending and the cap were retained; this is not a full-book accuracy certificate.", passageIds: plan.receipt.passageIds }].slice(-300);
  for (const key of ["costUsd", "measuredCostUsd", "estimatedCostUsd", "budgetUsd", "accountedCalls", "batches", "passHistory"] as const) assert.deepEqual(updated[key], checkpoint.value[key]);
  await supabaseWrite(jobKey, updated, lockedJob.etag);
  const verified = await supabaseRead<KnowledgeJob>(jobKey); assert.ok(verified); assert.equal(verified.value.qualityAuditLock, undefined); assert.equal(verified.value.stage, "paused"); assert.ok(verified.value.qualityAuditsApplied?.includes(manifest.id));
  assert.equal(verified.value.costUsd, checkpoint.value.costUsd); assert.equal(verified.value.budgetUsd, checkpoint.value.budgetUsd);
  console.log(JSON.stringify({ ...output, archiveVerified: true, stage: verified.value.stage, nodesNow: corpus.value.nodes.filter(n => n.type === "teaching").length, spendingPreserved: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Operator audit failed; no automatic scan was started"); process.exitCode = 1; });
