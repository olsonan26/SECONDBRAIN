import type { Draft } from "./types";

export function hasResearchPhrasing(text: string) {
  return /\b(?:the source material|according to (?:the )?(?:sources?|notes|documents?)|(?:the |our )(?:sources?|notes|documents?|text|chapter) (?:says?|states?|describes?|explains?|suggests?|notes?|mentions?|discusses?|outlines?|presents?|shows?|warns?|is candid)|source[- ](?:based|backed) (?:article|draft|response))\b/i.test(text);
}

export function cleanArticleBody(text: string, citationNumbers: number[] = []) {
  const known = new Set(citationNumbers);
  return text.replace(/^\s*# [^\r\n]*\r?\n+/, "")
    .replace(/[ \t]+((?:\[\d+\][ \t]*)+)(?=\r?$)/gm, (match, group: string) => {
      const numbers = [...group.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
      return numbers.every(n => known.has(n)) ? "" : match;
    })
    .replace(/\n*\*AI-written draft: review the cited source passages before publication\.\*\s*$/, "")
    .trim();
}

function headlineFromBrief(brief: string) {
  const topic = brief.replace(/^\s*(?:please\s+)?(?:write|create|draft|generate)\s+(?:(?:a|an|the|short|long|blog|engaging|professional|compelling|brief)\s+)*(?:article|post|blog post)\s*(?:about|on|regarding)?\s*/i, "").split(/[.!?]\s|[.!?]$/)[0].trim();
  const titled = topic.replace(/\b[a-z][a-z'-]*\b/gi, (word, offset: number) => {
    if (offset > 0 && /^(a|an|the|and|or|but|for|of|in|on|to|with)$/i.test(word)) return word.toLowerCase();
    return word[0].toUpperCase() + word.slice(1);
  }).replace(/^(Personal Year \d+)\s*,\s*/i, "$1: ");
  return titled.slice(0, 140) || "A Closer Look at the Source Material";
}

/** Non-destructive compatibility view for articles created before headline support. */
export function presentDraft(draft: Draft): Draft {
  if (draft.mode !== "model") return draft;
  const instructionTitle = draft.title.trim() === draft.brief.trim() || /^(?:please\s+)?(?:write|create|draft|generate)\s/i.test(draft.title);
  const embedded = draft.text.match(/^\s*# ([^\r\n]+)/)?.[1]?.trim();
  const title = instructionTitle ? (embedded && embedded !== draft.title && embedded !== draft.brief ? embedded : headlineFromBrief(draft.brief)) : draft.title;
  return { ...draft, title, text: cleanArticleBody(draft.text, draft.citations.map(c => c.number)) };
}

export function articleMarkdown(title: string, body: string) {
  return `# ${title.replace(/[\r\n]/g, " ").trim()}\n\n${body.replace(/^\s*# [^\r\n]*\r?\n+/, "").trim()}`;
}
