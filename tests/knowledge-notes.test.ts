import test from "node:test";
import assert from "node:assert/strict";
import { extractionSchema, reviewSchema, finalVerificationSchema } from "../src/lib/knowledge-schema";

const reason = "This passage was checked for reusable teachings and source evidence. ".repeat(25);
const audit = { passageId: "p", disposition: "excluded-noise", reason };

test("long processing explanations do not reject otherwise valid extraction, review or verification", () => {
  const extraction = extractionSchema.parse({ teachings: [], passages: [audit], gaps: [reason] });
  const review = reviewSchema.parse({ checks: [{ key: "t", supported: false, reason }], passages: [audit], reviewComplete: true, gaps: [reason] });
  const verification = finalVerificationSchema.parse({ teachings: [{ key: "t", supported: false, reason, usefulness: { decision: "book-metadata", reason } }], relationships: [{ index: 0, supported: false, reason }], passages: [{ passageId: "p", complete: true, reason }], gaps: [reason] });
  for (const note of [extraction.passages[0].reason, extraction.gaps[0], review.checks[0].reason, review.passages[0].reason, verification.teachings[0].reason, verification.teachings[0].usefulness!.reason, verification.relationships[0].reason, verification.passages[0].reason]) {
    assert.ok(note.length <= 900);
    assert.ok(note.endsWith("…"));
  }
  assert.equal(review.checks[0].supported, false);
  assert.equal(verification.teachings[0].supported, false);
  assert.equal(verification.relationships[0].supported, false);
  assert.equal(extraction.passages[0].disposition, "excluded-noise");
});

test("processing-note normalization never changes teaching text or evidence limits", () => {
  const teaching = { key: "t", label: "Activation timing", kind: "rule", topic: "Timing", text: "The activation begins at the vernal equinox, not on a birthday.", applicationTags: ["timing"], evidence: [{ passageId: "p", quote: "The activation begins at the vernal equinox." }] };
  const value = extractionSchema.parse({ teachings: [teaching], passages: [audit] });
  assert.equal(value.teachings[0].text, teaching.text);
  assert.deepEqual(value.teachings[0].evidence, teaching.evidence);
  assert.equal(extractionSchema.safeParse({ teachings: [{ ...teaching, text: "x".repeat(3501) }], passages: [audit] }).success, false);
  assert.equal(extractionSchema.safeParse({ teachings: [{ ...teaching, evidence: [{ passageId: "p", quote: "x".repeat(1801) }] }], passages: [audit] }).success, false);
  assert.equal(extractionSchema.safeParse({ teachings: [], passages: [{ ...audit, reason: 900 }] }).success, false);
});

test("short notes remain exact and long Unicode notes stay valid text", () => {
  const parse = (reason: string) => extractionSchema.parse({ teachings: [], passages: [{ ...audit, reason }] }).passages[0].reason;
  assert.equal(parse("Exact short note."), "Exact short note.");
  const normalized = parse("🌙".repeat(600));
  assert.ok(normalized.length <= 900);
  assert.equal(normalized.isWellFormed(), true);
});
