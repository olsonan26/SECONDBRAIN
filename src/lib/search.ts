import type { Corpus, Citation, Passage } from "./types";

const stop = new Set("a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our please should show so tell than that the their them there these they this to us was we were what when where which who why will with would you your about explain describe give find using use any all mean means meaning based according knowledge source sources".split(" "));
export function tokens(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => !stop.has(t) && (t.length > 1 || /^\d$/.test(t))).map(t => t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
}
function counts(text: string) { const result: Record<string, number> = {}; for (const term of tokens(text)) result[term] = (result[term] ?? 0) + 1; return result; }
const indexes = new WeakMap<Corpus, { docs: Map<string, Record<string, number>>; df: Map<string, number>; avg: number }>();
function index(corpus: Corpus) {
  const prior = indexes.get(corpus); if (prior) return prior;
  const docs = new Map<string, Record<string, number>>(), df = new Map<string, number>(); let total = 0;
  for (const p of corpus.passages) {
    const terms = counts(`${p.text}\n${p.sourceTitle}\n${p.section}`); docs.set(p.id, terms);
    for (const [term, n] of Object.entries(terms)) { total += n; df.set(term, (df.get(term) ?? 0) + 1); }
  }
  const result = { docs, df, avg: total / Math.max(1, corpus.passages.length) }; indexes.set(corpus, result); return result;
}
export function retrieve(corpus: Corpus, question: string, sourceIds: string[] = [], max = 8): Citation[] {
  const terms = [...new Set(tokens(question))]; if (!terms.length) return [];
  const idx = index(corpus), N = corpus.passages.length;
  const selected = new Set(sourceIds);
  const queryWords = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const candidates: { p: Passage; score: number; matched: number }[] = [];
  for (const p of corpus.passages) {
    if (selected.size && !selected.has(p.sourceId)) continue;
    const doc = idx.docs.get(p.id)!;
    const len = Object.values(doc).reduce((a, b) => a + b, 0);
    let score = 0, matched = 0;
    for (const term of terms) {
      const tf = doc[term] ?? 0;
      if (!tf) continue;
      matched++;
      const idf = Math.log(1 + (N - (idx.df.get(term) ?? 0) + 0.5) / ((idx.df.get(term) ?? 0) + 0.5));
      score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * len / Math.max(idx.avg, 1)));
      if (tokens(p.section + " " + p.sourceTitle).includes(term)) score += idf * 0.8;
    }
    if (!matched) continue;
    score *= Math.pow(matched / terms.length, 2);
    const normalized = p.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
    if (queryWords.length > 6 && normalized.includes(queryWords)) score *= 1.6;
    candidates.push({ p, score, matched });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return [];
  const meaningful = terms.filter(t => (idx.df.get(t) ?? 0) > 0);
  // A vague shared word must not turn an unrelated question into an answer.
  if (meaningful.length < Math.min(2, terms.length) || meaningful.length / terms.length < 0.6 || candidates[0].matched / terms.length < 0.6) return [];
  const out: Citation[] = [], perSource = new Map<string, number>();
  let chars = 0;
  for (const c of candidates) {
    if (out.length >= max) break;
    if (chars + c.p.text.length > 18_000) continue;
    if (c.score < candidates[0].score * 0.18) break;
    if ((perSource.get(c.p.sourceId) ?? 0) >= 3) continue;
    if (out.some(o => o.sourceId === c.p.sourceId && o.text.includes(c.p.text.slice(0, 140)))) continue;
    out.push({ ...c.p, terms: undefined, number: out.length + 1, score: Math.round(c.score * 100) / 100 });
    perSource.set(c.p.sourceId, (perSource.get(c.p.sourceId) ?? 0) + 1); chars += c.p.text.length;
  }
  return out;
}

export function extractiveText(citations: Citation[]) {
  return citations.slice(0, 5).map(c => {
    const sentences = c.text.split(/(?<=[.!?])\s+|\n\n/).filter(s => s.trim().length > 35);
    const excerpt = (sentences[0] || c.text).slice(0, 650).trim();
    return `**${c.sourceTitle}${c.page ? ` — page ${c.page}` : ""}** [${c.number}]\n\n> ${excerpt.replace(/\n/g, "\n> ")}`;
  }).join("\n\n");
}
