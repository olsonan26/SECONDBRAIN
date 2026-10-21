import type { GraphEdge, GraphNode } from "./types";

export const GRAPH_SCENE_LIMIT = 1800;
export const GRAPH_EDGE_LIMIT = 3800;

/** The scene is only a view. No node or relationship is removed from the knowledge graph. */
export function createGraphScene(nodes: GraphNode[], edges: GraphEdge[], selected: string | null, limit = GRAPH_SCENE_LIMIT) {
  const selectedNode = selected ? nodes.find(node => node.id === selected) : undefined;
  const neighborhood = new Set<string>();
  if (selectedNode) {
    neighborhood.add(selectedNode.id);
    for (const edge of edges) {
      if (edge.source === selected) neighborhood.add(edge.target);
      if (edge.target === selected) neighborhood.add(edge.source);
    }
  }
  const candidates = selectedNode ? nodes.filter(node => neighborhood.has(node.id)) : nodes;
  const ranked = [...candidates].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || b.degree - a.degree || a.id.localeCompare(b.id));
  const visibleNodes = ranked.slice(0, Math.max(1, limit));
  const visibleIds = new Set(visibleNodes.map(node => node.id));
  const eligibleEdges = edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const prioritizedEdges = selectedNode ? [...eligibleEdges].sort((a, b) => Number(b.source === selected || b.target === selected) - Number(a.source === selected || a.target === selected)) : eligibleEdges;
  return {
    nodes: visibleNodes,
    edges: prioritizedEdges.slice(0, GRAPH_EDGE_LIMIT),
    candidateCount: candidates.length,
    eligibleEdgeCount: eligibleEdges.length,
    focused: !!selectedNode,
  };
}
