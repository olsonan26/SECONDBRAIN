import type { Corpus, GraphNode, GraphEdge, KnowledgePassageAudit } from "./types";
import { nonTeachingNodeReason } from "./knowledge-usefulness";

export const curationPolicy = "useful-teachings-v1";
export function planKnowledgeCuration(corpus: Corpus) {
  const nodes = corpus.nodes.filter(node => node.type === "teaching" && nonTeachingNodeReason(node));
  const ids = new Set(nodes.map(node => node.id));
  const edges = corpus.edges.filter(edge => ids.has(edge.source) || ids.has(edge.target));
  const keptEdges = corpus.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target));
  const degrees = new Map<string, number>();
  for (const edge of keptEdges) { degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1); degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1); }
  return { nodes, edges, corpus: { ...corpus, nodes: corpus.nodes.filter(node => !ids.has(node.id)).map(node => ({ ...node, degree: degrees.get(node.id) ?? 0 })), edges: keptEdges } };
}

type CuratableJob = { nodesAdded: number; edgesAdded: number; passages: KnowledgePassageAudit[]; curationApplied?: string[] };
export function curateJob<T extends CuratableJob>(job: T, nodes: GraphNode[], edges: GraphEdge[]): T {
  if (job.curationApplied?.includes(curationPolicy)) return job;
  const ids = new Set(nodes.map(node => node.id));
  return { ...job, nodesAdded: Math.max(0, job.nodesAdded - nodes.length), edgesAdded: Math.max(0, job.edgesAdded - edges.length), curationApplied: [...(job.curationApplied ?? []), curationPolicy], passages: job.passages.map(audit => {
    const kept = audit.nodeIds.filter(id => !ids.has(id));
    return kept.length === audit.nodeIds.length ? audit : { ...audit, nodeIds: kept, ...(kept.length ? {} : { disposition: "excluded-noise" as const, reason: "Owner's useful-teaching policy: publication and author commentary archived, not chart-reading knowledge." }) };
  }) };
}
