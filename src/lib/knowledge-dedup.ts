import { createHash } from "node:crypto";
import type { GraphNode, GraphEdge, KnowledgeEvidence } from "./types";

export function teachingFingerprint(node: GraphNode) {
  const normalized = node.description.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[\s]+/g, " ").trim().replace(/[.!?]+$/, "");
  return `${node.knowledgeKind ?? node.type}|${normalized}`;
}
export function mergeRepeatedTeachings(existing: GraphNode[], incoming: GraphNode[], incomingEdges: GraphEdge[]) {
  const fingerprints = new Map(existing.filter(node => node.type === "teaching").map(node => [teachingFingerprint(node), node]));
  const redirects = new Map<string, string>(), replacements = new Map<string, GraphNode>(), added: GraphNode[] = [];
  const evidenceKey = (evidence: KnowledgeEvidence) => `${evidence.sourceId}|${evidence.passageId}|${evidence.imageId ?? ""}|${evidence.quote}|${evidence.visualObservation ?? ""}`;
  for (const node of incoming) {
    const fingerprint = teachingFingerprint(node), match = fingerprints.get(fingerprint);
    if (match) {
      redirects.set(node.id, match.id);
      const merged = { ...match, aliases: [...new Set([match.label, node.label, ...(match.aliases ?? []), ...(node.aliases ?? [])])], sourceIds: [...new Set([...match.sourceIds, ...node.sourceIds])], applicationTags: [...new Set([...(match.applicationTags ?? []), ...(node.applicationTags ?? [])])], evidence: [...new Map([...(match.evidence ?? []), ...(node.evidence ?? [])].map(evidence => [evidenceKey(evidence), evidence])).values()] };
      fingerprints.set(fingerprint, merged); replacements.set(match.id, merged);
    } else { fingerprints.set(fingerprint, node); added.push(node); }
  }
  const edges = incomingEdges.flatMap(edge => {
    const source = redirects.get(edge.source) ?? edge.source, target = redirects.get(edge.target) ?? edge.target;
    if (source === target) return [];
    return [{ ...edge, source, target, id: source === edge.source && target === edge.target ? edge.id : `merged-${createHash("sha256").update(`${source}|${target}|${edge.relation}`).digest("hex").slice(0, 28)}` }];
  });
  return { nodes: [...existing.map(node => replacements.get(node.id) ?? node), ...added.map(node => replacements.get(node.id) ?? node)], edges, redirects, added: added.length, merged: redirects.size };
}
export function mergeGraphEdges(existing: GraphEdge[], incoming: GraphEdge[]) {
  const edges = new Map<string, GraphEdge>();
  for (const edge of [...existing, ...incoming]) {
    const key = `${edge.source}|${edge.target}|${edge.relation.toLowerCase().trim()}|${edge.confidence}`;
    const prior = edges.get(key);
    edges.set(key, prior ? { ...prior, sourceIds: [...new Set([...prior.sourceIds, ...edge.sourceIds])], evidence: [...new Map([...(prior.evidence ?? []), ...(edge.evidence ?? [])].map(item => [`${item.sourceId}|${item.passageId}|${item.quote}|${item.visualObservation ?? ""}`, item])).values()] } : edge);
  }
  return { edges: [...edges.values()], added: edges.size - new Set(existing.map(edge => `${edge.source}|${edge.target}|${edge.relation.toLowerCase().trim()}|${edge.confidence}`)).size };
}
