import type { Citation, Corpus } from "./types";
import { retrieve, tokens } from "./search";

/** Graph labels route a question to original passages; they are never evidence. */
export function retrieveWithKnowledge(corpus: Corpus, question: string, sourceIds: string[] = [], applicationTags: string[] = [], max = 8): Citation[] {
  const direct = retrieve(corpus, question, sourceIds, max);
  const terms = [...new Set(tokens(question))];
  const allowed = new Set(sourceIds), tags = new Set(applicationTags);
  const passages = new Map(corpus.passages.map(p => [p.id, p]));
  const candidates = corpus.nodes.flatMap(node => {
    if (!node.evidence?.length || (allowed.size && !node.sourceIds.some(id => allowed.has(id)))) return [];
    const words = new Set(tokens([node.label, node.description, ...(node.aliases ?? [])].join(" ")));
    const matched = terms.filter(term => words.has(term)).length;
    const tagged = (node.applicationTags ?? []).filter(tag => tags.has(tag)).length;
    if ((!matched || matched / Math.max(1, terms.length) < 0.5) && !tagged) return [];
    return [{ node, score: matched * 3 + tagged * 2 + (node.knowledgeKind === "method" || node.knowledgeKind === "rule" ? 0.1 : 0) }];
  }).sort((a, b) => b.score - a.score);
  const routed: Citation[] = [];
  let routedCharacters = 0;
  for (const candidate of candidates) {
    for (const evidence of candidate.node.evidence ?? []) {
      const passage = passages.get(evidence.passageId);
      const supported = passage && (evidence.imageId ? passage.image?.id === evidence.imageId && (evidence.visualObservation?.length ?? 0) >= 20 : evidence.quote.length >= 12 && passage.text.includes(evidence.quote));
      if (!passage || !supported || passage.sourceId !== evidence.sourceId || (allowed.size && !allowed.has(passage.sourceId)) || routed.some(c => c.id === passage.id)) continue;
      if (routed.length >= max || routedCharacters + passage.text.length > 18_000) break;
      routed.push({ ...passage, terms: undefined, number: routed.length + 1, score: candidate.score });
      routedCharacters += passage.text.length;
    }
    if (routed.length >= max) break;
  }
  // Reserve room for evidenced graph routing even when lexical retrieval is full.
  const order = [...routed.slice(0, Math.min(3, max)), ...direct, ...routed.slice(3)];
  const out: Citation[] = []; let characters = 0, images = 0;
  for (const passage of order) {
    if (out.length >= max) break;
    if (out.some(c => c.id === passage.id) || characters + passage.text.length > 18_000) continue;
    if (passage.image && images >= 2) continue;
    if (passage.image) images++;
    out.push({ ...passage, number: out.length + 1 }); characters += passage.text.length;
  }
  return out;
}
