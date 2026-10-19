import test from "node:test";
import assert from "node:assert/strict";
import { presentDraft, articleMarkdown, hasResearchPhrasing } from "../src/lib/article-presentation";
import type { Draft } from "../src/lib/types";

const brief = "Write a short article about personal year 7, reflection and study.";
const draft: Draft = { id: "test", title: brief, brief, text: `# ${brief}\n\nA compelling opening. [3]\n\n## Space to think\n\nKeep **IMPORTANT wording** intact. [1] [3]\n\n*AI-written draft: review the cited source passages before publication.*`, status: "draft", mode: "model", author: "Alex", revision: 1, updatedAt: "", citations: [1,3].map(number => ({ number, id: String(number), sourceId: "source", sourceTitle: "Source", text: "Evidence stays available", page: 1, section: "", lineStart: 1, lineEnd: 1, score: 1 })) };

test("legacy instruction-titles become reader-facing headlines and citations stay out of article text", () => {
  const result = presentDraft(draft);
  assert.equal(result.title, "Personal Year 7: Reflection and Study");
  assert.ok(!result.text.includes(brief));
  assert.doesNotMatch(result.text, /\[1\]|\[3\]|AI-written draft/);
  assert.match(result.text, /\*\*IMPORTANT wording\*\*/);
  assert.match(result.text, /## Space to think/);
  assert.deepEqual(result.citations, draft.citations);
  assert.equal(draft.title, brief, "Presentation must not overwrite stored drafts");
  assert.equal(presentDraft(result).text, result.text);
});

test("copy/export includes the current headline once and preserves genuine numeric links", () => {
  const result = presentDraft({ ...draft, title: "A thoughtful headline", text: "# A thoughtful headline\n\nRead [3](https://example.com). Keep array[3] and year 2026. [3]" });
  const markdown = articleMarkdown("A revised headline", result.text);
  assert.equal((markdown.match(/^# /gm) || []).length, 1);
  assert.ok(markdown.startsWith("# A revised headline\n\n"));
  assert.match(markdown, /\[3\]\(https:\/\/example.com\)/);
  assert.match(markdown, /array\[3\]/);
  assert.ok(markdown.endsWith("year 2026."));
});

test("research outlines remain clearly labeled rather than being passed off as generated articles", () => {
  const outline = { ...draft, mode: "extractive" as const, status: "outline" as const };
  assert.deepEqual(presentDraft(outline), outline);
});

test("article voice rejects research-report commentary without banning ordinary prose", () => {
  for (const text of ["The source material describes this cycle.", "The notes describe a period of reflection.", "According to the source, this is true.", "The source notes that study matters."]) assert.equal(hasResearchPhrasing(text), true);
  for (const text of ["Make room for reflection.", "A melody's notes can build tension.", "Think of this cycle as an invitation to study."]) assert.equal(hasResearchPhrasing(text), false);
});
