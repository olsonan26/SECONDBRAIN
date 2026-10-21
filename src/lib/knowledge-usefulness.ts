import type { GraphNode } from "./types";

export const reusableKnowledgeInstructions = `USEFULNESS IS A SEPARATE REQUIREMENT FROM TRUTH. This graph is a working subject-knowledge library, not a catalog of every true sentence. A node must teach a reusable subject definition, meaning, correspondence, calculation, chart ingredient, interpretation, condition, exception, reading procedure or instructive worked example. Preserve domain foundations and relevant astronomy when they explain the method; do not restrict extraction to a short wish list. EXCLUDE publication titles, volume counts, page numbering, page counts, index/glossary locations, publishing history, sales claims, claims of novelty or superiority, the author's complaints about other astrologers, and commentary that the word astrology does not describe the book. These are excluded-noise, not definitions/rules/warnings merely because they are true. Keep substantive book-specific technical terminology and actual methodological differences: for example, a definition of delegate, PHSR's ordered steps, a decan mapping or an explicit timing exception IS knowledge. A preface can contain real teachings; decide per assertion, not by page or chapter. For each proposed node ask: what concrete subject question, interpretation or calculation can someone answer using THIS statement? A question about the book's title, layout, author or publishing history does not qualify. If no reusable teaching is present, output zero teachings and exclude the nonteaching material; never pad the graph. Only genuinely ambiguous teaching relevance merits a usefulness clarification. Do not manufacture a practical application or infer a rule from a slogan.`;

/** Narrow backstop for obvious publishing/promotional labels, not a vocabulary whitelist. */
export function nonTeachingNodeReason(node: Pick<GraphNode, "label" | "description">): string | null {
  const label = node.label.toLowerCase();
  if (/\bpage numbering\b|\boriginal single tome\b|\bglossary\b.*\b(?:end|volume)\b|\bsplit into\b.*\bvolumes?\b|\b(?:work|book)\b.*\btwo volumes\b|\b(?:work|book)\b.*\b(?:titled|presented under)\b/.test(label)) return "Publication metadata, not reusable subject knowledge.";
  if (/\bnew field of study\b|\bword\b.*\bastrology\b.*\b(?:insufficient|scope|usage)\b|\bauthor.s claim\b.*\bastrology\b.*\bdrifted\b/.test(label)) return "Author positioning or commentary, not a substantive teaching.";
  return null;
}

export type UsefulnessAssessment = {
  decision: "teaching" | "book-metadata" | "author-commentary" | "nonteaching-story" | "uncertain";
  reason: string;
  applicationQuestion?: string;
};
export const usefulnessVerificationInstructions = `For EVERY teaching check, include a separate usefulness object: {"decision":"teaching|book-metadata|author-commentary|nonteaching-story|uncertain","reason":"specific relevance judgement","applicationQuestion":"the concrete subject question this statement actually answers"}. Only decision=teaching with a meaningful applicationQuestion can enter the graph, even when supported=true. Do not call publication or promotional facts teachings. Omit applicationQuestion for nonteaching decisions rather than inventing an application. For pure nonteaching passages propose excluded-noise and complete=true only if no substantive teaching was omitted; mixed passages must retain their real teachings. Missing usefulness checks fail closed. The evidence supported flag remains a separate factual check.`;
export function isUsefulTeaching(node: Pick<GraphNode, "label" | "description">, assessment?: UsefulnessAssessment) {
  return !nonTeachingNodeReason(node) && assessment?.decision === "teaching" && (assessment.applicationQuestion?.trim().length ?? 0) >= 12;
}
