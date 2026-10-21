import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { imageMessages, imageContextCeiling, readPassageImage } from "../src/lib/knowledge-images";
import { knowledgeEvidenceSchema, validatedEvidence, extractionSchema, reviewSchema, finalVerificationSchema, independentlyVerifiedFragment, requiresVisualStructureReview } from "../src/lib/knowledge-schema";
import { mergeRepeatedTeachings, mergeGraphEdges } from "../src/lib/knowledge-dedup";
import { validateGroundedOutput } from "../src/lib/grounding";
import type { Passage, GraphNode, GraphEdge } from "../src/lib/types";

const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4, 255, 217]);
const passage: Passage = { id: "photo-test", sourceId: "photos", sourceTitle: "Originals", page: null, section: "Photo", lineStart: 1, lineEnd: 1, text: "1800 Opposition: unverified OCR.", image: { id: "image-test", driveId: "valid_original_drive_id_123456789", sha256: createHash("sha256").update(bytes).digest("hex"), filename: "page.jpg", mimeType: "image/jpeg", ocrVerified: false } };

test("original images are fingerprint-checked and sent as actual multimodal input in every phase", async () => {
  const original = globalThis.fetch; let downloads = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "test/vision", architecture: { input_modalities: ["text", "image"] }, context_length: 1_000_000, pricing: { image: "0" } }] });
    assert.match(String(url), /^https:\/\/drive.google.com\/uc\?/); downloads++;
    return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
  };
  try {
    assert.equal(await imageContextCeiling("test/vision"), 1_000_000);
    await assert.rejects(() => imageContextCeiling("test/text-only"), /not listed as accepting images/);
    for (const phase of ["extract", "review", "verify"]) {
      const messages = await imageMessages([{ role: "system", content: "Source only" }, { role: "user", content: JSON.stringify({ phase }) }], [passage]);
      const content = messages[1].content;
      assert.ok(Array.isArray(content));
      assert.equal(content[0].text, JSON.stringify({ phase }));
      assert.ok("image_url" in content[2]);
      assert.equal(content[2].image_url?.url, `data:image/jpeg;base64,${bytes.toString("base64")}`);
    }
    assert.equal(downloads, 1, "Same immutable image can be cached across the three checks.");
    await assert.rejects(() => readPassageImage({ ...passage, image: { ...passage.image!, sha256: "a".repeat(64) } }), /fingerprint/);
    await assert.rejects(() => imageMessages([{ role: "user", content: "test" }], [passage, { ...passage, image: { ...passage.image!, id: "other" } }]), /Too many/);
  } finally { globalThis.fetch = original; }
});

test("visual evidence must identify its actual source image, never fabricated OCR or another page", () => {
  const observation = "Visible heading reads 180° Opposition, not the OCR's 1800.";
  const evidence = knowledgeEvidenceSchema.parse({ passageId: passage.id, imageId: passage.image!.id, visualObservation: observation });
  assert.equal(validatedEvidence([evidence], [passage])?.[0].visualObservation, observation);
  assert.equal(validatedEvidence([{ ...evidence, imageId: "other-image" }], [passage]), null);
  assert.equal(validatedEvidence([evidence], [{ ...passage, image: undefined }]), null);
  assert.equal(knowledgeEvidenceSchema.safeParse({ passageId: passage.id, quote: "" }).success, false);
  assert.equal(validatedEvidence([{ passageId: passage.id, quote: passage.text }], [passage]), null, "OCR-only evidence is forbidden for photo-backed teachings.");
  const output = { paragraphs: [{ text: "This is the 180° Opposition heading.", citations: [1], evidence: [{ citation: 1, imageId: passage.image!.id, visualObservation: observation }] }] };
  assert.ok(validateGroundedOutput(output, [{ ...passage, number: 1, score: 1 }]));
  assert.equal(validateGroundedOutput(output, [{ ...passage, image: undefined, number: 1, score: 1 }]), false);
});

test("independent final duplicate checks merge equivalent wording without losing its source evidence", () => {
  const evidence = { passageId: passage.id, imageId: passage.image!.id, visualObservation: "The printed heading visibly reads 180° Opposition." };
  const a = { key: "a", label: "Opposition angle", kind: "definition", topic: "Opposition", text: "The visible Opposition heading specifies 180 degrees.", aliases: [], applicationTags: [], evidence: [evidence] };
  const b = { ...a, key: "b", label: "180-degree opposition", text: "The Opposition angle is shown as 180 degrees." };
  const candidate = extractionSchema.parse({ teachings: [a, b], passages: [{ passageId: passage.id, disposition: "extracted", reason: "Heading is legible." }] });
  const review = reviewSchema.parse({ checks: [{ key: "a", supported: true, reason: "Visible heading." }, { key: "b", supported: true, reason: "Visible heading." }], passages: candidate.passages, reviewComplete: true });
  const usefulness = { decision: "teaching", reason: "The exact aspect angle is useful in chart calculation.", applicationQuestion: "What is the angle of an opposition?" };
  const verification = finalVerificationSchema.parse({ teachings: [{ key: "a", supported: true, reason: "Exactly matches image.", usefulness }, { key: "b", supported: true, duplicateOf: "a", reason: "Same angle with no distinct conditions.", usefulness }], relationships: [], passages: [{ passageId: passage.id, complete: true, reason: "All visible heading knowledge retained." }] });
  const fragment = independentlyVerifiedFragment(candidate, review, verification, [passage], "job", { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [passage], nodes: [], edges: [], warnings: [] });
  assert.equal(fragment.nodes.length, 1); assert.equal(fragment.audits[0].nodeIds.length, 1);
  assert.ok(fragment.nodes[0].aliases?.includes(b.label));
  assert.ok(fragment.edges.every(edge => edge.target === fragment.nodes[0].id));
});

const node = (id: string, description: string, sourceId = "one"): GraphNode => ({ id, label: id, type: "teaching", knowledgeKind: "rule", layer: "uploaded", community: "Aspects", sourceIds: [sourceId], description, degree: 0, evidence: [{ passageId: sourceId, sourceId, page: null, quote: "Exact supporting original words." }] });
test("exact repeated claims merge provenance but numbers, planets, negations and conditions remain distinct", () => {
  const existing = node("old", "The Sun is at 180 degrees, not 150.");
  const incoming = node("new", "The Sun is at 180 degrees, not 150.", "two");
  const distinct = [node("moon", "The Moon is at 180 degrees, not 150."), node("degrees", "The Sun is at 150 degrees, not 180."), node("exception", "The Sun is at 180 degrees only when this condition applies.")];
  const merged = mergeRepeatedTeachings([existing], [incoming, ...distinct], []);
  assert.equal(merged.added, 3); assert.equal(merged.nodes.length, 4);
  assert.deepEqual(merged.nodes[0].sourceIds, ["one", "two"]);
  assert.equal(merged.nodes[0].evidence?.length, 2);
  assert.equal(merged.redirects.get("new"), "old");
  const edge: GraphEdge = { id: "e1", source: "source:one", target: "old", relation: "contains teaching", confidence: "EXTRACTED", score: 1, sourceIds: ["one"] };
  const repeated = mergeGraphEdges([edge], [{ ...edge, id: "e2", sourceIds: ["two"] }]);
  assert.equal(repeated.added, 0); assert.equal(repeated.edges.length, 1); assert.deepEqual(repeated.edges[0].sourceIds, ["one", "two"]);
});

test("unverified small chart glyph mappings are held for separate review, not published as facts", () => {
  const evidence = [{ passageId: passage.id, sourceId: passage.sourceId, page: null, quote: "", imageId: passage.image!.id, visualObservation: "A proposed observation of small glyphs in the original wheel image." }];
  assert.equal(requiresVisualStructureReview({ label: "Wheel diagram: aspect glyphs", description: "A square appears in sector 2.", evidence }), true);
  assert.equal(requiresVisualStructureReview({ label: "Natural rulership rather than personal signs", description: "The printed prose explicitly distinguishes natural rulership from the native's signs.", evidence }), false);
});
