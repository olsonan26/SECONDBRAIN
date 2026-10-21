import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assembleRecoverySourcePlan, recoverPdfSource, verifyRecoveryPhoto, RECOVERY_ASTROLOGY_BRAIN_ID, ORIGINAL_ASTROLOGY_BRAIN_ID, RECOVERY_SOURCE_DATE } from "../scripts/recovery-source-plan";
import { textPdf } from "./fixtures/pdf";
import type { Corpus, Source } from "../src/lib/types";

const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
function main(): Corpus {
  const content = "A real retained Main source with enough text to be retrieved without a model.";
  const source: Source = { id: "main-source", title: "Main", filename: "main.txt", layer: "foundation", format: "txt", characters: content.length, pages: 0, sha256: hash(content), importedAt: RECOVERY_SOURCE_DATE, provenance: "Local retained source", originalAvailable: false, content };
  return { version: 1, importedAt: RECOVERY_SOURCE_DATE, snapshotDate: "2026-05-14", sources: [source], passages: [{ id: "main-passage", sourceId: source.id, sourceTitle: source.title, page: null, section: "", lineStart: 1, lineEnd: 1, text: content }], nodes: [], edges: [], warnings: ["Retained original warning"] };
}
function photo(suffix = "a", text = "Unverified original page OCR") {
  const bytes = Buffer.from([255, 216, 255, 224, suffix.charCodeAt(0), 255, 217]);
  const input = { id: `original_image_drive_id_${suffix}`, name: `${suffix}.jpg`, bytes: bytes.length, mime: "image/jpeg" };
  return verifyRecoveryPhoto(input, { id: input.id, sha256: hash(bytes), ocr: { text } }, bytes, `${suffix}.jpg`);
}

test("recovery PDF ingestion retains all pages with deterministic normal-ingestion IDs", async () => {
  const bytes = textPdf(3);
  const first = await recoverPdfSource(bytes, "test.pdf", "Test book.pdf");
  const again = await recoverPdfSource(bytes, "test.pdf", "Test book.pdf");
  assert.deepEqual(first, again);
  assert.equal(first.source.id, `upload-${hash(first.source.content!).slice(0, 20)}`);
  assert.equal(first.source.pages, 3);
  assert.ok(first.passages.some(p => p.page === 1));
  assert.ok(first.passages.some(p => p.page === 3), "The last page is not truncated");
  assert.equal(first.original.sha256, hash(bytes));
  assert.ok(first.passages.every(p => first.source.content!.includes(p.text)));
});

test("source-only recovery preserves Main, isolates Astrology and creates no teachings, jobs or spending reset", async () => {
  const original = main(), before = structuredClone(original);
  const pdf = await recoverPdfSource(textPdf(1), "one.pdf", "Book.pdf");
  const plan = assembleRecoverySourcePlan({ mainCorpus: original, pdfs: [pdf], photos: [photo()], requirements: ["1. How do I read a chart?\n- Profections"] });
  assert.deepEqual(original, before);
  assert.deepEqual(plan.mainCorpus, before);
  assert.notEqual(plan.mainCorpus, original);
  assert.notEqual(RECOVERY_ASTROLOGY_BRAIN_ID, ORIGINAL_ASTROLOGY_BRAIN_ID);
  assert.match(RECOVERY_ASTROLOGY_BRAIN_ID, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(plan.astrologyBrain.name, "Astrology (recovered sources)");
  assert.ok(plan.astrologyCorpus.nodes.every(n => n.type === "document"));
  assert.equal(plan.astrologyCorpus.edges.length, 0);
  assert.equal(plan.astrologyCorpus.knowledgeCommits, undefined);
  assert.equal(plan.recoveryReport.counts.recoveredTeachings, 0);
  assert.equal(plan.completeCloudState, false);
  assert.ok(plan.recoveryReport.pendingCloudRecords.some(k => k.includes(ORIGINAL_ASTROLOGY_BRAIN_ID)));
  assert.equal(plan.requirementsProfile?.entries.length, 2);
  assert.equal(plan.requirementsProfile?.jobId, "recovery-sources-unscanned");
  assert.ok(!("jobs" in plan) && !("costUsd" in plan));
  assert.ok(plan.astrologyCorpus.passages.every(p => p.sourceId !== "main-source"));
  assert.ok(plan.originals.every(o => o.brainId === RECOVERY_ASTROLOGY_BRAIN_ID));
});

test("exact image bytes deduplicate but equal OCR on different photographs never does", async () => {
  const pdf = await recoverPdfSource(textPdf(1), "one.pdf", "Book.pdf");
  const a = photo("a", "Same OCR words"), b = photo("b", "Same OCR words"), duplicate = { ...a, id: "original_image_drive_id_duplicate", name: "z.jpg", path: "duplicate.jpg" };
  const plan = assembleRecoverySourcePlan({ mainCorpus: main(), pdfs: [pdf, pdf], photos: [duplicate, b, a] });
  const reordered = assembleRecoverySourcePlan({ mainCorpus: main(), pdfs: [pdf, pdf], photos: [a, duplicate, b] });
  assert.deepEqual(plan, reordered);
  assert.equal(plan.astrologyCorpus.sources.length, 2, "The same PDF content is not imported twice");
  assert.equal(plan.photoManifest.originalCount, 3);
  assert.equal(plan.photoManifest.uniqueCount, 2);
  assert.equal(plan.photoManifest.originalFiles.length, 3, "Original duplicate bytes remain auditable");
  assert.equal(plan.photoManifest.duplicates[0].original, a.id);
  const passages = plan.astrologyCorpus.passages.filter(p => p.image);
  assert.equal(passages.length, 2);
  assert.notEqual(passages[0].id, passages[1].id);
  assert.ok(passages.every(p => p.page === null && p.image!.ocrVerified === false));
});

test("blank image OCR is retained for visual inspection instead of losing the page", async () => {
  const pdf = await recoverPdfSource(textPdf(1), "one.pdf", "Book.pdf");
  const plan = assembleRecoverySourcePlan({ mainCorpus: main(), pdfs: [pdf], photos: [photo("a", "")] });
  const p = plan.astrologyCorpus.passages.find(p => p.image)!;
  assert.match(p.text, /Image-only page/);
  assert.equal(p.page, null);
  assert.ok(p.image!.sha256 && !p.image!.ocrVerified);
  assert.equal(plan.requirementsProfile, null);
});

test("recovery rejects mismatched bytes, missing Main content and source mismatches", async () => {
  const bytes = Buffer.from([255, 216, 255, 224, 1, 255, 217]);
  const input = { id: "original_image_drive_id_a", name: "a.jpg", bytes: bytes.length, mime: "image/jpeg" };
  assert.throws(() => verifyRecoveryPhoto(input, { id: input.id, sha256: "0".repeat(64), ocr: { text: "OCR" } }, bytes, "a.jpg"), /fingerprint mismatch/);
  assert.throws(() => verifyRecoveryPhoto(input, { id: "wrong", sha256: hash(bytes), ocr: { text: "OCR" } }, bytes, "a.jpg"), /another original/);
  assert.throws(() => verifyRecoveryPhoto({ ...input, bytes: 1 }, {}, bytes, "a.jpg"), /size mismatch/);
  const pdf = await recoverPdfSource(textPdf(1), "one.pdf", "Book.pdf"), missing = main();
  missing.sources[0].content = undefined;
  assert.throws(() => assembleRecoverySourcePlan({ mainCorpus: missing, pdfs: [pdf], photos: [photo()] }), /content is missing/);
  const damaged = main(); damaged.sources[0].content += " changed";
  assert.throws(() => assembleRecoverySourcePlan({ mainCorpus: damaged, pdfs: [pdf], photos: [photo()] }), /fingerprint mismatch/);
  assert.throws(() => assembleRecoverySourcePlan({ mainCorpus: main(), pdfs: [{ ...pdf, passages: [{ ...pdf.passages[0], sourceId: "wrong" }] }], photos: [photo()] }), /source mismatch/);
});
