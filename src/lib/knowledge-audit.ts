import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Corpus, GraphNode } from "./types";
import type { KnowledgeJob } from "./knowledge";
import { extractionSchema, finalVerificationSchema, validatedEvidence } from "./knowledge-schema";
import { isUsefulTeaching } from "./knowledge-usefulness";
import { mergeGraphEdges } from "./knowledge-dedup";

export type QualityAuditManifest = {
  id: string; jobId: string; reviewedAt: string;
  reviewedImages: { passageId: string; imageId: string; sha256: string; printedPage?: number }[];
  decisions: { id: string; beforeHash: string; action: "exclude" | "hold" | "merge" | "replace"; reason: string; mergeInto?: string; replacement?: GraphNode }[];
  additions: GraphNode[];
};
export const auditHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Explicit operator review only; never called by a model-facing public API. */
export function planQualityAudit(corpus: Corpus, job: KnowledgeJob, manifest: QualityAuditManifest) {
  assert.equal(job.stage, "paused", "Pause the job before operator corrections");
  assert.ok(job.batches.every(batch => !batch.lease), "Wait for all active leases before correcting knowledge");
  assert.equal(manifest.jobId, job.id);
  assert.match(manifest.id, /^[a-z0-9-]{8,100}$/);
  const manifestHash = auditHash(manifest), prior = corpus.qualityAuditReceipts?.[manifest.id];
  if (prior) { assert.equal(prior.manifestHash, manifestHash, "Audit identity cannot be reused for different decisions"); return { corpus, receipt: prior, beforeNodes: [], beforeEdges: [] }; }
  assert.ok(manifest.decisions.length + manifest.additions.length <= 100, "Keep individual operator patches bounded");
  const attestations = new Map(manifest.reviewedImages.map(image => [image.passageId, image]));
  for (const image of manifest.reviewedImages) {
    const passage = corpus.passages.find(p => p.id === image.passageId);
    assert.equal(passage?.image?.id, image.imageId, "Reviewed image identity changed");
    assert.equal(passage?.image?.sha256, image.sha256, "Reviewed image fingerprint changed");
  }
  const decisions = new Map(manifest.decisions.map(decision => [decision.id, decision]));
  assert.equal(decisions.size, manifest.decisions.length, "Conflicting audit decisions");
  const affected = new Set<string>();
  const inspected = (node: GraphNode) => {
    assert.equal(node.type, "teaching"); assert.equal(node.extractionJobId, job.id, "Cannot silently curate another job");
    assert.ok(node.evidence?.length, "Source evidence is mandatory");
    for (const evidence of node.evidence!) { assert.ok(attestations.has(evidence.passageId), "Every affected evidence page must be explicitly reviewed"); affected.add(evidence.passageId); }
  };
  for (const decision of manifest.decisions) {
    const node = corpus.nodes.find(n => n.id === decision.id); assert.ok(node, "Audited node disappeared");
    assert.equal(auditHash(node), decision.beforeHash, "Audited node changed; inspect the new version first");
    assert.ok(decision.reason.length >= 10); inspected(node);
    if (decision.action === "replace") assert.equal(decision.replacement?.id, node.id, "Corrections preserve the existing node identity");
    if (decision.action === "merge") {
      const target = corpus.nodes.find(n => n.id === decision.mergeInto); assert.ok(target, "Merge target missing"); inspected(target);
      assert.ok(!decisions.has(target.id) || decisions.get(target.id)!.action === "replace", "No chained/deleted merge targets");
    }
  }
  const stamp = (node: GraphNode): GraphNode => {
    inspected(node);
    extractionSchema.shape.teachings.element.parse({ key: node.id, label: node.label, kind: node.knowledgeKind, topic: node.community, text: node.description, aliases: node.aliases ?? [], applicationTags: node.applicationTags ?? [], evidence: node.evidence });
    const proof = validatedEvidence(node.evidence!, corpus.passages); assert.ok(proof, "Correction evidence does not match the original source");
    const check = finalVerificationSchema.shape.teachings.element.parse({ key: node.id, supported: true, reason: "Operator inspected the original source photograph.", usefulness: { decision: "teaching", reason: "Operator inspected the original source photograph.", applicationQuestion: node.applicationQuestion, teachingClass: node.knowledgeUse?.teachingClass, technicalStatement: node.knowledgeUse?.technicalStatement } });
    assert.ok(isUsefulTeaching(node, check.usefulness), "Correction still fails the substantive teaching policy");
    assert.deepEqual([...new Set(proof.map(e => e.sourceId))].sort(), [...node.sourceIds].sort());
    return { ...node, evidence: proof, qualityReview: { auditId: manifest.id, reviewedAt: manifest.reviewedAt, method: "original-photo-manual" } };
  };
  const changed = new Set([...decisions.keys(), ...manifest.decisions.flatMap(d => d.mergeInto ? [d.mergeInto] : [])]);
  const kept = corpus.nodes.flatMap(node => {
    const decision = decisions.get(node.id);
    if (decision && decision.action !== "replace") return [];
    return [decision?.replacement ? stamp(decision.replacement) : node];
  });
  for (const decision of manifest.decisions.filter(d => d.action === "merge")) {
    const source = corpus.nodes.find(n => n.id === decision.id)!, index = kept.findIndex(n => n.id === decision.mergeInto);
    const target = kept[index];
    kept[index] = stamp({ ...target, aliases: [...new Set([...(target.aliases ?? []), ...(source.aliases ?? []), source.label].filter(label => label.length <= 100))], evidence: [...new Map([...(target.evidence ?? []), ...source.evidence!].map(e => [auditHash(e), e])).values()] });
  }
  for (const addition of manifest.additions) { assert.ok(!corpus.nodes.some(n => n.id === addition.id), "Added node already exists"); assert.ok(!kept.some(n => n.id === addition.id), "Duplicate addition"); kept.push(stamp(addition)); changed.add(addition.id); }
  const beforeNodes = corpus.nodes.filter(node => changed.has(node.id));
  const beforeEdges = corpus.edges.filter(edge => changed.has(edge.source) || changed.has(edge.target));
  // Old semantic relations may no longer match a narrowed claim. Archive them,
  // keep unrelated relations, and rebuild only directly evidenced membership.
  const membership = kept.filter(node => changed.has(node.id)).flatMap(node => node.sourceIds.map(sourceId => ({ id: `operator-${auditHash(`${sourceId}|${node.id}`).slice(0, 28)}`, source: `source:${sourceId}`, target: node.id, relation: "contains teaching", confidence: "EXTRACTED" as const, score: 1, sourceIds: [sourceId], evidence: node.evidence?.filter(e => e.sourceId === sourceId), extractionJobId: job.id })));
  const edges = mergeGraphEdges(corpus.edges.filter(edge => !changed.has(edge.source) && !changed.has(edge.target)), membership).edges;
  const degrees = new Map<string, number>(); for (const edge of edges) for (const id of [edge.source, edge.target]) degrees.set(id, (degrees.get(id) ?? 0) + 1);
  const receipt = { manifestHash, nodeDelta: kept.length - corpus.nodes.length, edgeDelta: edges.length - corpus.edges.length, passageIds: [...affected] };
  return { corpus: { ...corpus, nodes: kept.map(node => ({ ...node, degree: degrees.get(node.id) ?? 0 })), edges, qualityAuditReceipts: { ...corpus.qualityAuditReceipts, [manifest.id]: receipt } }, receipt, beforeNodes, beforeEdges };
}

export function settleQualityAudit(job: KnowledgeJob, corpus: Corpus, manifest: QualityAuditManifest): KnowledgeJob {
  const receipt = corpus.qualityAuditReceipts?.[manifest.id]; assert.ok(receipt); assert.equal(receipt.manifestHash, auditHash(manifest));
  if (job.qualityAuditsApplied?.includes(manifest.id)) return job;
  assert.equal(job.stage, "paused"); assert.ok(!job.qualityAuditLock || job.qualityAuditLock === manifest.id);
  const affected = new Set(receipt.passageIds), present = new Set(corpus.nodes.map(n => n.id));
  const nodesAdded = job.nodesAdded + receipt.nodeDelta, edgesAdded = job.edgesAdded + receipt.edgeDelta; assert.ok(nodesAdded >= 0 && edgesAdded >= 0);
  return { ...job, qualityAuditLock: undefined, qualityAuditsApplied: [...(job.qualityAuditsApplied ?? []), manifest.id], nodesAdded, edgesAdded, passages: job.passages.map(passage => affected.has(passage.passageId) ? { ...passage, disposition: "unresolved", reason: "Operator source-photo audit corrected relevance, scope, granularity or omissions. Accepted corrections are saved; this sample audit does not certify complete coverage or all relationships.", nodeIds: [...new Set(corpus.nodes.filter(n => n.type === "teaching" && n.evidence?.some(e => e.passageId === passage.passageId)).map(n => n.id))] } : { ...passage, nodeIds: passage.nodeIds.filter(id => present.has(id)) }) };
}
