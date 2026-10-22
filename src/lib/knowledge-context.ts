import type { Corpus, Passage } from "./types";

const NAVIGATION_BYTES = 6000;
type Navigation = { nodes: { id: string; label: string; teaching: string }[]; relationships: { source: string; relation: string; target: string }[]; limited: boolean };

/** Navigation is never evidence. Pay for a bounded duplicate-check index only
 * in the final verifier; source text, images and proposed claims remain whole. */
export function knowledgeNavigation(corpus: Corpus, passages: Passage[], phase: "extract" | "review" | "verify"): Navigation {
  const result: Navigation = { nodes: [], relationships: [], limited: true };
  if (phase !== "verify") return result;
  const ids = new Set(passages.map(p => p.id));
  const words = new Set(passages.flatMap(p => p.text.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? []));
  const candidates = corpus.nodes.filter(node => node.type === "teaching").map(node => ({ node, score: node.evidence?.some(e => ids.has(e.passageId)) ? 1000 : (node.label.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? []).filter(word => words.has(word)).length })).filter(item => item.score >= 2).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  for (const { node } of candidates) {
    if (result.nodes.length >= 20) break;
    result.nodes.push({ id: node.id, label: node.label, teaching: node.description });
    // Do not cut off a qualification/negation to squeeze another claim in.
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > NAVIGATION_BYTES) result.nodes.pop();
  }
  const selected = new Set(result.nodes.map(node => node.id));
  const labels = new Map(result.nodes.map(node => [node.id, node.label]));
  for (const edge of corpus.edges) {
    if (result.relationships.length >= 8) break;
    if (!selected.has(edge.source) || !selected.has(edge.target)) continue;
    result.relationships.push({ source: labels.get(edge.source)!, relation: edge.relation, target: labels.get(edge.target)! });
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > NAVIGATION_BYTES) result.relationships.pop();
  }
  return result;
}
