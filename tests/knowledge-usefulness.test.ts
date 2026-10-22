import test from "node:test";
import assert from "node:assert/strict";
import { extractionSchema, reviewSchema, finalVerificationSchema, independentlyVerifiedFragment } from "../src/lib/knowledge-schema";
import type { Corpus, Passage } from "../src/lib/types";

const corpus: Corpus = { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [], nodes: [], edges: [], warnings: [] };
function extract(text: string, label: string, usefulness?: unknown) {
  const passage: Passage = { id: "p", sourceId: "book", sourceTitle: "Book", page: 1, section: "", lineStart: 1, lineEnd: 1, text };
  const dispositions = [{ passageId: "p", disposition: "extracted", reason: "The statement is present." }];
  const candidate = extractionSchema.parse({ teachings: [{ key: "t", label, kind: "rule", topic: "Topic", text, applicationTags: [], evidence: [{ passageId: "p", quote: text }] }], passages: dispositions });
  const review = reviewSchema.parse({ checks: [{ key: "t", supported: true, reason: "Exactly stated in this passage." }], passages: dispositions, reviewComplete: true });
  const verification = finalVerificationSchema.parse({ teachings: [{ key: "t", supported: true, reason: "Exactly stated in this passage.", ...(usefulness ? { usefulness } : {}) }], relationships: [], passages: [{ passageId: "p", complete: true, reason: "Statement is retained." }] });
  return independentlyVerifiedFragment(candidate, review, verification, [passage], "job", corpus);
}

test("a plausible application question cannot turn branding, stories or worksheet inventory into knowledge", () => {
  const cases = [
    ["References to 'Alchemystic Astrology' in the work are to be understood as 'Alchemystic Cosmodynamics'", "Any reference to Alchemystic Astrology herein should be understood as Alchemystic Cosmodynamics; future teachings proceed under that name."],
    ["Terminology convention", "Any reference to Alchemystic Astrology herein should be understood as Alchemystic Cosmodynamics."],
    ["Blank progressed-chart template includes a Date entry field", "The blank progressed-chart template includes a Date field at the bottom of the page."],
    ["The system is framed as a spiritual science", "The author characterizes the system as a spiritual science concerned with coherence and repeatable outcomes."],
    ["Author's personal journey into astrology", "The author recalls a personal journey into astrology and describes friends who encouraged the work."],
  ];
  for (const [label, text] of cases) {
    const fragment = extract(text, label, { decision: "teaching", teachingClass: "technical-definition", technicalStatement: text, applicationQuestion: "What does the author mean by this terminology?", reason: "The statement and terminology occur in the source." });
    assert.equal(fragment.nodes.length, 0, label);
  }
});

test("source-supported publishing facts and author commentary are not teaching nodes", () => {
  const cases = [
    ["Work is titled Alchemystic Astrology but limited by common astrology usage", "The work is presented under the name Alchemystic Astrology but is limited by common astrology usage.", "book-metadata"],
    ["Page numbering flows continuously between volumes", "Page numbering flows continuously from Volume 1 into Volume 2.", "book-metadata"],
    ["Astrology has drifted away from accuracy", "The author claims astrology has drifted away from repeatable results.", "author-commentary"],
  ];
  for (const [label, text, decision] of cases) {
    const fragment = extract(text, label, { decision, reason: "This describes the publication or opinions, not a reading rule.", applicationQuestion: "What is this book called?" });
    assert.equal(fragment.nodes.length, 0, label);
    assert.equal(fragment.edges.length, 0);
    assert.equal(fragment.audits[0].disposition, "excluded-noise", "Definite noise should not cause repeated paid rescans");
  }
});

test("calling obvious publishing metadata a teaching does not bypass the relevance backstop", () => {
  const fragment = extract("The work is titled Alchemystic Astrology.", "Work is titled Alchemystic Astrology", { decision: "teaching", reason: "The title is explicitly printed.", applicationQuestion: "What is this book called?" });
  assert.equal(fragment.nodes.length, 0);
});

test("editorial transitions and autobiographical house-system choices cannot masquerade as technical knowledge", () => {
  const cases = [
    ["House system choice: the author had difficulty switching from one system to another", "The author had a hard time switching house systems and promises to discuss the transition in another chapter."],
    ["Author's claim: the standard profection technique needed to be fixed to make it work", "The author says the standard profection technique needed to be fixed, but gives no replacement timing rule in this assertion."],
    ["After the mechanical function of retrogrades is known, the astrological translation is given as keywords for future interpreting", "Now that the mechanics have been explained, the chapter introduces a list of keywords for later interpreting."],
  ];
  for (const [label, text] of cases) {
    const result = extract(text, label, { decision: "teaching", teachingClass: "reading-procedure", technicalStatement: text, applicationQuestion: "How does this technique work in a chart?", reason: "The statement is present on the page." });
    assert.equal(result.nodes.length, 0, label);
  }
});

test("arbitrary alphabetical keyword bundles are unresolved teachings, not excluded source noise", () => {
  const text = "The retrograde keyword list associates retrogrades with Absorbing, Adjust, Attracting and Backtracking.";
  const result = extract(text, "Retrograde keyword list (A–B): Absorbing, Adjust, Attracting, Backtracking", { decision: "teaching", teachingClass: "correspondence", technicalStatement: text, applicationQuestion: "Which meanings are associated with retrogrades?", reason: "The source lists these associations." });
  assert.equal(result.nodes.length, 0);
  assert.equal(result.audits[0].disposition, "unresolved", "Keep genuine bundled knowledge for splitting rather than claiming it was irrelevant.");
  const atomic = "Retrograde is associated with the keyword Absorbing; no separate definition is supplied here.";
  assert.equal(extract(atomic, "Retrograde correspondence: Absorbing", { decision: "teaching", teachingClass: "correspondence", technicalStatement: atomic, applicationQuestion: "What is one keyword associated with retrogrades?", reason: "One explicit subject association." }).nodes.length, 1);
});

test("a mere evidence check cannot bypass a missing or uncertain usefulness assessment", () => {
  const text = "The activation begins at the vernal equinox, not on a birthday.";
  assert.equal(extract(text, "Activation timing").nodes.length, 0);
  assert.equal(extract(text, "Activation timing", { decision: "teaching", reason: "Useful in this chart-reading method.", applicationQuestion: "When does this activation occur?" }).nodes.length, 0, "A question alone is not a substantive teaching assessment");
  assert.equal(extract(text, "Activation timing", { decision: "uncertain", reason: "The practical teaching cannot yet be identified." }).nodes.length, 0);
});

test("genuine meanings, formulas, procedures and qualified rules remain accepted", () => {
  const cases = [
    ["Activation timing", "The activation begins at the vernal equinox, not on a birthday.", "When does this system activate a profection?"],
    ["PHSR reading order", "Read the planet, then its house, then its sign, then its ruler, and repeat.", "In what order should I assess a placement using PHSR?"],
    ["Virgo second decan", "The second Virgo decan extends from 10 degrees through 19 degrees 59 minutes and corresponds to Capricorn.", "Which decan correspondence applies to Virgo at 14 degrees?"],
    ["Saturn return period", "In this framework, Saturn returns to its natal position approximately every 29.5 years.", "What approximate period does this Saturn return rule use?"],
    ["Book-specific technical definition", "In this book, a delegate is the planet assigned to carry a house's rulership function.", "What does delegate mean when applying this rulership method?"],
  ];
  for (const [label, text, applicationQuestion] of cases) {
    assert.equal(extract(text, label, { decision: "teaching", teachingClass: "interpretation-rule", technicalStatement: text, applicationQuestion, reason: "This supplies a reusable subject definition, interpretation or procedure." }).nodes.length, 1, label);
  }
});

test("a mixed preface passage keeps its actual technique while excluding book metadata", () => {
  const text = "The work is titled Alchemystic Astrology. The activation begins at the vernal equinox, not on a birthday.";
  const passage: Passage = { id: "mixed", sourceId: "book", sourceTitle: "Book", page: 1, section: "Preface", lineStart: 1, lineEnd: 1, text };
  const candidate = extractionSchema.parse({ teachings: [
    { key: "title", label: "Work is titled Alchemystic Astrology", kind: "rule", topic: "Book", text: "The work is titled Alchemystic Astrology.", applicationTags: [], evidence: [{ passageId: passage.id, quote: "The work is titled Alchemystic Astrology." }] },
    { key: "timing", label: "Activation timing", kind: "rule", topic: "Timing", text: "The activation begins at the vernal equinox, not on a birthday.", applicationTags: ["timing"], evidence: [{ passageId: passage.id, quote: "The activation begins at the vernal equinox, not on a birthday." }] },
  ], passages: [{ passageId: passage.id, disposition: "extracted", reason: "Timing rule is present." }] });
  const review = reviewSchema.parse({ checks: candidate.teachings.map(t => ({ key: t.key, supported: true, reason: "Explicit source statement." })), passages: candidate.passages, reviewComplete: true });
  const verification = finalVerificationSchema.parse({ teachings: [
    { key: "title", supported: true, reason: "Explicit title.", usefulness: { decision: "book-metadata", reason: "Only the publication title, not a technique." } },
    { key: "timing", supported: true, reason: "Explicit timing rule.", usefulness: { decision: "teaching", teachingClass: "interpretation-rule", technicalStatement: "The activation begins at the vernal equinox, not on a birthday.", reason: "Defines timing and a precise exception.", applicationQuestion: "When does this activation occur?" } },
  ], relationships: [], passages: [{ passageId: passage.id, complete: true, reason: "The rule is retained and the title excluded." }] });
  const result = independentlyVerifiedFragment(candidate, review, verification, [passage], "job", corpus);
  assert.deepEqual(result.nodes.map(node => node.label), ["Activation timing"]);
  assert.equal(result.nodes[0].applicationQuestion, "When does this activation occur?");
  assert.equal(result.nodes[0].knowledgeUse?.policy, "substantive-teachings-v2");
  assert.equal(result.nodes[0].knowledgeUse?.teachingClass, "interpretation-rule");
  assert.equal(result.audits[0].disposition, "extracted");
});
