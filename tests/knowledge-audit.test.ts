import assert from "node:assert/strict";
import test from "node:test";
import { auditHash, planQualityAudit, settleQualityAudit, type QualityAuditManifest } from "../src/lib/knowledge-audit";
import type { Corpus, GraphNode, Passage } from "../src/lib/types";
import type { KnowledgeJob } from "../src/lib/knowledge";

const passage: Passage = { id: "p", sourceId: "book", sourceTitle: "Book", page: null, section: "Photo", lineStart: 1, lineEnd: 1, text: "OCR is not verified.", image: { id: "image-p", driveId: "test_original_drive_id_123456", sha256: "a".repeat(64), filename: "page.jpg", mimeType: "image/jpeg" } };
const node = (id: string): GraphNode => ({ id, label: "Conditional activation timing " + id, description: "The source gives a specific activation timing condition and its exception.", type: "teaching", layer: "uploaded", community: "Timing", sourceIds: ["book"], degree: 0, knowledgeKind: "rule", applicationQuestion: "When does this conditional activation begin?", knowledgeUse: { policy: "substantive-teachings-v2", teachingClass: "interpretation-rule", technicalStatement: "The activation uses the stated timing condition rather than a universal rule." }, evidence: [{ passageId: "p", sourceId: "book", page: null, quote: "", imageId: "image-p", visualObservation: "The printed timing paragraph explicitly states this condition and its exception." }], extractionJobId: "job-fixture" });
function fixture() {
  const nodes = [node("editorial"), node("keep"), node("duplicate"), node("unsupported")];
  const edges = nodes.map(n => ({ id: "source-" + n.id, source: "source:book", target: n.id, relation: "contains teaching", confidence: "EXTRACTED" as const, score: 1, sourceIds: ["book"], extractionJobId: "job-fixture" }));
  edges.push({ ...edges[0], id: "relation-1", source: "keep", target: "duplicate", relation: "related" }, { ...edges[0], id: "relation-2", source: "unsupported", target: "keep", relation: "implies" });
  const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [passage], nodes, edges, warnings: [] };
  const job: KnowledgeJob = { version: 1, id: "job-fixture", brainId: "test", sourceIds: ["book"], author: "Alex", createdAt: "", updatedAt: "", stage: "paused", provider: "openrouter", model: "test", requirements: "", budgetUsd: 10, costUsd: 6.397, measuredCostUsd: 5.591, estimatedCostUsd: .806, estimatedTotalCostUsd: 20, inputTokens: 100, outputTokens: 100, nodesAdded: 4, edgesAdded: 6, accountedCalls: ["previous-billed-call"], batches: [], passageHashes: { p: "unchanged" }, passages: [{ passageId: "p", sourceId: "book", page: null, disposition: "extracted", reason: "Original audit", nodeIds: nodes.map(n => n.id) }], warnings: [] };
  const manifest: QualityAuditManifest = { id: "source-audit-fixture-v1", jobId: job.id, reviewedAt: "2026-10-22T00:00:00Z", reviewedImages: [{ passageId: "p", imageId: "image-p", sha256: "a".repeat(64) }], decisions: [
    { id: "editorial", beforeHash: auditHash(nodes[0]), action: "exclude", reason: "Explicit operator exclusion of editorial content." },
    { id: "keep", beforeHash: auditHash(nodes[1]), action: "replace", reason: "Narrow the claim to the actual source condition.", replacement: { ...nodes[1], description: "In this worked case only, the specific activation follows the source timing condition." } },
    { id: "duplicate", beforeHash: auditHash(nodes[2]), action: "merge", reason: "Operator confirmed the same conditional technical claim.", mergeInto: "keep" },
    { id: "unsupported", beforeHash: auditHash(nodes[3]), action: "hold", reason: "The proposed broad rule exceeds the source evidence." },
  ], additions: [node("new-association")] };
  return { corpus, job, manifest };
}

test("operator corrections are reversible, source-bound and exactly-once without resetting spending or coverage", () => {
  const { corpus, job, manifest } = fixture(), original = JSON.stringify({ corpus, job });
  const plan = planQualityAudit(corpus, job, manifest);
  assert.equal(plan.beforeNodes.length, 4); assert.equal(plan.beforeEdges.length, 6);
  assert.equal(plan.receipt.nodeDelta, -2); assert.equal(plan.receipt.edgeDelta, -4);
  assert.deepEqual(plan.corpus.nodes.map(n => n.id), ["keep", "new-association"]);
  assert.ok(plan.corpus.nodes.every(n => n.qualityReview?.method === "original-photo-manual"));
  assert.ok(plan.corpus.edges.every(e => e.relation === "contains teaching"), "Do not invent or carry over semantic relations after narrowing claims.");
  assert.deepEqual(plan.corpus.passages, corpus.passages); assert.deepEqual(plan.corpus.sources, corpus.sources);
  const settled = settleQualityAudit({ ...job, qualityAuditLock: manifest.id }, plan.corpus, manifest);
  for (const key of ["costUsd", "measuredCostUsd", "estimatedCostUsd", "budgetUsd", "accountedCalls", "batches", "passageHashes"] as const) assert.deepEqual(settled[key], job[key]);
  assert.equal(settled.nodesAdded, 2); assert.equal(settled.edgesAdded, 2);
  assert.equal(settled.passages[0].disposition, "unresolved", "A sample correction cannot certify a whole page as complete.");
  assert.deepEqual(settled.passages[0].nodeIds, ["keep", "new-association"]);
  assert.equal(settled.qualityAuditLock, undefined);
  assert.equal(settleQualityAudit(settled, plan.corpus, manifest), settled, "No double subtraction after a retry.");
  const recovered = planQualityAudit(plan.corpus, job, manifest);
  assert.equal(recovered.corpus, plan.corpus, "A committed corpus receipt replays without re-editing nodes.");
  assert.deepEqual(settleQualityAudit(job, recovered.corpus, manifest), settled, "Recover a crash between corpus and checkpoint writes.");
  assert.equal(JSON.stringify({ corpus, job }), original);
});

test("operator patches reject stale nodes, changed images, unrelated sources, reused identities and active work", () => {
  const { corpus, job, manifest } = fixture();
  assert.throws(() => planQualityAudit(corpus, { ...job, stage: "running" }, manifest), /Pause/);
  assert.throws(() => planQualityAudit(corpus, { ...job, batches: [{ id: "0", passageIds: ["p"], phase: "extract", state: "leased", attempts: 1, revision: 0, lease: { token: "active", expiresAt: 1, reservation: .1 } }] }, manifest), /active leases/);
  const stale = structuredClone(corpus); stale.nodes[0].description += "Changed.";
  assert.throws(() => planQualityAudit(stale, job, manifest), /changed/);
  const changedPhoto = structuredClone(corpus); changedPhoto.passages[0].image!.sha256 = "b".repeat(64);
  assert.throws(() => planQualityAudit(changedPhoto, job, manifest), /fingerprint/);
  const noPhoto = { ...manifest, reviewedImages: [] };
  assert.throws(() => planQualityAudit(corpus, job, noPhoto), /explicitly reviewed/);
  const wrongProof = structuredClone(manifest); wrongProof.additions[0].evidence![0].imageId = "another-image";
  assert.throws(() => planQualityAudit(corpus, job, wrongProof), /evidence/);
  const applied = planQualityAudit(corpus, job, manifest).corpus;
  assert.throws(() => planQualityAudit(applied, job, { ...manifest, additions: [] }), /identity/);
});
