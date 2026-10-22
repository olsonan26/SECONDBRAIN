import assert from "node:assert/strict";
import test from "node:test";
import { parseKnowledgeResponse } from "../src/lib/knowledge-response";
import type { Teaching } from "../src/lib/knowledge-schema";

const context = { passageIds: ["p1", "p2"] };
const teaching: Teaching = { key: "t1", label: "Activation timing", kind: "rule", topic: "Timing", text: "Activation begins at the vernal equinox, not on a birthday.", aliases: [], applicationTags: ["timing"], evidence: [{ passageId: "p1", quote: "Activation begins at the vernal equinox, not on a birthday." }] };
const candidate = { teachings: [teaching], relationships: [], passages: [], gaps: [], clarifications: [] };
const check = { key: "t1", supported: true, reason: "All conditions are supported.", usefulness: { decision: "teaching", reason: "A reusable precise timing rule.", teachingClass: "interpretation-rule", technicalStatement: teaching.text, applicationQuestion: "When does activation begin?" } };

test("only enum spelling is normalized, never unknown semantics, teaching text or evidence", () => {
  const result = parseKnowledgeResponse("extract", { teachings: [{ ...teaching, kind: " RULE " }, { ...teaching, key: "bad", kind: "concept" }], passages: [] }, context);
  assert.equal(result.value.teachings.length, 1);
  assert.equal(result.value.teachings[0].kind, "rule");
  assert.equal(result.value.teachings[0].text, teaching.text);
  assert.deepEqual(result.value.teachings[0].evidence, teaching.evidence);
  assert.equal(result.holds[0].teachingKey, "bad");
  assert.deepEqual(result.holds[0].passageIds, ["p1"]);
  const verified = parseKnowledgeResponse("verify", { teachings: [{ ...check, usefulness: { ...check.usefulness, teachingClass: "Interpretation_Rule" } }], relationships: [], passages: [] }, { ...context, candidate });
  assert.equal(verified.value.teachings[0].usefulness?.teachingClass, "interpretation-rule");
});

test("invalid usefulness is held without guessing missing proof or converting a rejection into support", () => {
  const result = parseKnowledgeResponse("verify", { teachings: [
    check,
    { ...check, key: "bad-class", usefulness: { ...check.usefulness, teachingClass: "concept" } },
    { ...check, key: "short", usefulness: { ...check.usefulness, technicalStatement: "Short" } },
    { key: "rejected", supported: false, reason: "The assertion is contradicted." },
    { ...check, key: "coerced", supported: "true" },
  ], relationships: [], passages: [] }, { ...context, candidate });
  assert.deepEqual(result.value.teachings.map(t => [t.key, t.supported]), [["t1", true], ["rejected", false]]);
  assert.equal(result.holds.length, 3);
  assert.deepEqual(result.holds.find(h => h.teachingKey === "bad-class")?.passageIds, context.passageIds, "Unlocatable errors conservatively retain all target passages for review.");
});

test("malformed duplicate checks cannot become apparent exact-once approvals", () => {
  const verified = parseKnowledgeResponse("verify", { teachings: [check, { ...check, usefulness: { ...check.usefulness, teachingClass: "invalid" } }], relationships: [{ index: 0, supported: true, reason: "Supported." }, { index: 0, supported: "false", reason: "Bad duplicate." }], passages: [] }, { ...context, candidate });
  assert.equal(verified.value.teachings.length, 0);
  assert.equal(verified.value.relationships.length, 0);
  const reviewed = parseKnowledgeResponse("review", { checks: [{ key: "t1", supported: true, reason: "Supported." }, { key: "t1", supported: "false", reason: "Bad duplicate." }], passages: [], reviewComplete: true }, { ...context, candidate });
  assert.equal(reviewed.value.checks.length, 0);
});

test("malformed envelopes remain fatal instead of being silently replaced with empty results", () => {
  for (const input of [null, [], {}, { teachings: "invalid", passages: [] }, { teachings: [], passages: {} }, { teachings: Array(151).fill(teaching), passages: [] }]) assert.throws(() => parseKnowledgeResponse("extract", input, context));
  assert.throws(() => parseKnowledgeResponse("review", { checks: [], passages: [], reviewComplete: "true" }, context));
  assert.throws(() => parseKnowledgeResponse("verify", { teachings: [], passages: [] }, context));
});
