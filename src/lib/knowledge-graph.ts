import type { Corpus, GraphNode } from "./types";
import { createGraphScene } from "./graph-scene";

function compact(node: GraphNode): GraphNode {
  return { ...node, label: node.label.slice(0, 180), description: node.description.slice(0, 500), sourceIds: node.sourceIds.slice(0, 8), aliases: node.aliases?.slice(0, 6).map(alias => alias.slice(0, 80)), evidence: node.evidence?.slice(0, 1).map(e => ({ ...e, quote: e.quote.slice(0, 220), visualObservation: e.visualObservation?.slice(0, 350) })) };
}
/** Keep SSR/API payloads bounded; the complete graph remains in private storage. */
export function knowledgeOverview(corpus: Corpus) {
  const scene = createGraphScene(corpus.nodes, corpus.edges, null);
  let nodeBytes = 0, edgeBytes = 0;
  const nodes: GraphNode[] = [];
  for (const original of scene.nodes) {
    const node = compact(original), bytes = Buffer.byteLength(JSON.stringify(node));
    if (nodeBytes + bytes > 1_400_000) break;
    nodes.push(node); nodeBytes += bytes;
  }
  const ids = new Set(nodes.map(n => n.id));
  const edges = [];
  for (const { evidence, ...original } of scene.edges) {
    if (!ids.has(original.source) || !ids.has(original.target)) continue;
    const edge = { ...original, sourceIds: original.sourceIds.slice(0, 8) }, bytes = Buffer.byteLength(JSON.stringify(edge));
    if (edgeBytes + bytes > 650_000) break;
    edges.push(edge); edgeBytes += bytes;
  }
  // All bootstrap nodes are previews; exact teaching/evidence is loaded on selection.
  return { nodes, edges, graphOverviewOnly: corpus.nodes.length > 0 };
}
export function searchKnowledgeNodes(corpus: Corpus, query: string, offset = 0, limit = 50) {
  const terms = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matching = corpus.nodes.filter(node => {
    if (!terms.length) return true;
    const text = `${node.label} ${node.description} ${node.community} ${(node.aliases ?? []).join(" ")}`.normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const start = Math.max(0, Math.min(matching.length, Math.floor(offset)));
  return { nodes: matching.slice(start, start + Math.max(1, Math.min(100, limit))).map(compact), total: matching.length };
}
export function knowledgeNodeDetail(corpus: Corpus, id: string) {
  const node = corpus.nodes.find(n => n.id === id);
  if (!node) return null;
  const related = corpus.edges.filter(e => e.source === id || e.target === id);
  const edges = related.slice(0, 180);
  const ids = new Set(edges.flatMap(e => [e.source, e.target])); ids.add(id);
  return { node, nodes: corpus.nodes.filter(n => ids.has(n.id)).map(n => n.id === id ? n : compact(n)), edges, totalConnections: related.length };
}
