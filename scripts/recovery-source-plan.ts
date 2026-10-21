import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractText } from "unpdf";
import { createPassages } from "./import-brain";
import { parseQuestionRequirements, type QuestionRequirement } from "../src/lib/knowledge-questions";
import type { Brain, Corpus, Passage, Source } from "../src/lib/types";

// This namespace deliberately differs from the unavailable production brain.
// Recovery never resets its job, spending ledger, accepted nodes or source claims.
export const RECOVERY_ASTROLOGY_BRAIN_ID = "5c9e08c7-21fd-4c8e-95a1-1c6830ff092d";
export const RECOVERY_SOURCE_DATE = "2026-10-21T00:00:00.000Z";
export const ORIGINAL_ASTROLOGY_BRAIN_ID = "a2f66ffe-ae02-40eb-a264-a5697dcb6c5b";
const PHOTO_SOURCE_ID = "astrology-original-page-photographs";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export interface RecoveryPhotoInput {
  id: string; name: string; bytes: number; mime: string;
}
export interface RecoveryPhoto {
  id: string; name: string; bytes: number; sha256: string; text: string; path: string;
}
export interface RecoveryPdf {
  source: Source; passages: Passage[];
  original: { sourceId: string; format: "pdf"; path: string; sha256: string; bytes: number };
}
export interface RecoverySourcePlan {
  version: 1;
  completeCloudState: false;
  mainCorpus: Corpus;
  astrologyBrain: Brain;
  astrologyCorpus: Corpus;
  originals: (RecoveryPdf["original"] & { brainId: string })[];
  photoManifest: {
    version: 1; sourceId: string; originalCount: number; uniqueCount: number; sha256: string;
    images: NonNullable<Passage["image"]>[];
    duplicates: { duplicate: string; original: string; sha256: string }[];
    originalFiles: { driveId: string; path: string; sha256: string; bytes: number }[];
  };
  requirementsProfile: null | { version: 1; jobId: string; updatedAt: string; entries: QuestionRequirement[]; warnings: string[] };
  recoveryReport: {
    version: 1; kind: "source-only-recovery"; completeCloudState: false;
    originalBrainId: string; recoveredBrainId: string; sourceFingerprint: string;
    counts: { mainSources: number; mainPassages: number; mainNodes: number; mainEdges: number; astrologySources: number; astrologyPassages: number; originalPhotos: number; uniquePhotos: number; duplicatePhotos: number; recoveredTeachings: 0; requirements: number };
    pendingCloudRecords: string[]; warnings: string[];
  };
}

/** Validate actual JPEG bytes against both independent local inventories. */
export function verifyRecoveryPhoto(input: RecoveryPhotoInput, rawOcr: unknown, bytes: Uint8Array, file: string): RecoveryPhoto {
  assert.match(input.id, /^[A-Za-z0-9_-]{20,100}$/, "Invalid original image ID");
  assert.equal(input.mime, "image/jpeg", "Only original JPEG pages are accepted");
  assert.equal(bytes.length, input.bytes, "Original photograph size mismatch");
  assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8, "Original photograph is not a JPEG");
  const ocr = rawOcr as { id?: unknown; sha256?: unknown; ocr?: { text?: unknown } };
  assert.equal(ocr.id, input.id, "OCR file belongs to another original image");
  assert.equal(typeof ocr.ocr?.text, "string", "Missing OCR text, even if blank");
  const sha256 = hash(bytes);
  assert.equal(ocr.sha256, sha256, "Original photograph fingerprint mismatch");
  return { id: input.id, name: input.name, bytes: bytes.length, sha256, text: ocr.ocr!.text as string, path: path.resolve(file) };
}

/** Match normal PDF ingestion IDs and preserve every extracted page. No storage writes. */
export async function recoverPdfSource(bytes: Uint8Array, file: string, filename: string, importedAt = RECOVERY_SOURCE_DATE): Promise<RecoveryPdf> {
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-", "Original book is not a PDF");
  const parsed = await extractText(new Uint8Array(bytes), { mergePages: false });
  const content = parsed.text.map((text, i) => `## Page ${i + 1}\n\n${text}`).join("\n\n");
  assert.ok(content.replace(/#+\s*Page\s*\d+/g, "").trim().length >= 40, "Original PDF has no readable text");
  const sha256 = hash(content), id = `upload-${sha256.slice(0, 20)}`;
  const source: Source = {
    id, title: filename.replace(/\.[^.]+$/, ""), filename, layer: "uploaded", format: "pdf", characters: content.length,
    pages: parsed.text.length, sha256, importedAt, originalAvailable: true, content,
    provenance: "Recovered from locally retained original PDF bytes. PDF page numbers are not verified printed-page labels. Text may omit or misread charts; the separately attached original page photographs remain the visual evidence.",
  };
  return { source, passages: createPassages(source, content), original: { sourceId: id, format: "pdf", path: path.resolve(file), sha256: hash(bytes), bytes: bytes.length } };
}

/** Pure assembly of already byte-verified sources. No model, network or storage calls. */
export function assembleRecoverySourcePlan(input: { mainCorpus: Corpus; pdfs: RecoveryPdf[]; photos: RecoveryPhoto[]; requirements?: string[]; importedAt?: string }): RecoverySourcePlan {
  const importedAt = input.importedAt ?? RECOVERY_SOURCE_DATE;
  assert.ok(Number.isFinite(Date.parse(importedAt)), "Recovery date is invalid");
  assert.ok(input.mainCorpus.sources.length > 0, "Refusing an empty Main recovery");
  const mainIds = new Set(input.mainCorpus.sources.map(source => source.id));
  assert.equal(mainIds.size, input.mainCorpus.sources.length, "Duplicate Main source IDs");
  for (const source of input.mainCorpus.sources) {
    assert.equal(typeof source.content, "string", "Main source content is missing");
    assert.equal(hash(source.content!), source.sha256, "Main source content fingerprint mismatch");
  }
  assert.ok(input.mainCorpus.passages.every(passage => mainIds.has(passage.sourceId)), "Main passage has no source");
  assert.ok(input.pdfs.length > 0 && input.photos.length > 0, "Both original books and original photographs are required");
  const warnings = [
    "Source-only recovery in a separate brain. The original cloud Astrology teachings, drafts, extraction checkpoint and spending ledger remain unavailable; none were reset, rebuilt or represented as recovered.",
    "No AI extraction has run in this recovered brain. Document nodes identify source documents, not extracted teachings. No completeness claim is made.",
    "OCR is an unverified search aid. Original SHA256-verified photographs must be inspected for chart drawings, numerals and glyphs; printed page mapping is not assumed from file order.",
  ];
  const pdfs: RecoveryPdf[] = [], pdfHashes = new Set<string>();
  for (const pdf of input.pdfs) {
    assert.equal(hash(pdf.source.content ?? ""), pdf.source.sha256, "Recovered PDF text fingerprint mismatch");
    assert.ok(pdf.passages.every(passage => passage.sourceId === pdf.source.id), "PDF passage source mismatch");
    if (pdfHashes.has(pdf.source.sha256)) continue;
    pdfHashes.add(pdf.source.sha256); pdfs.push(pdf);
  }
  const unique = new Map<string, RecoveryPhoto>(), imageIds = new Set<string>();
  const duplicates: RecoverySourcePlan["photoManifest"]["duplicates"] = [];
  // A bytewise comparator avoids locale-dependent order in source fingerprints.
  const ordered = [...input.photos].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const photo of ordered) {
    assert.match(photo.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!imageIds.has(photo.id), "Duplicate original image ID"); imageIds.add(photo.id);
    const existing = unique.get(photo.sha256);
    if (existing) { duplicates.push({ duplicate: photo.id, original: existing.id, sha256: photo.sha256 }); continue; }
    unique.set(photo.sha256, photo);
  }
  const photos = [...unique.values()];
  const source: Source = {
    id: PHOTO_SOURCE_ID, title: "Astrology — original page photographs", filename: "Original book photographs (Batches 1–8)", layer: "uploaded", format: "photo-book",
    characters: photos.reduce((n, photo) => n + photo.text.length, 0), pages: photos.length,
    sha256: hash(photos.map(photo => photo.sha256).join("\n")), importedAt, originalAvailable: false,
    provenance: `${input.photos.length} original local JPEGs fingerprint-checked against their OCR manifests; ${photos.length} unique image pages. Exact duplicate bytes are retained in the source audit, not extracted twice. Image bytes remain in the verified encrypted GitHub backup and authenticated Drive-backed image pipeline; this source is not a single downloadable original file. OCR is unverified.`,
  };
  const passages: Passage[] = photos.map(photo => {
    const text = photo.text || "[Image-only page: inspect the attached original photograph.]";
    return { id: `photo-${photo.sha256.slice(0, 28)}`, sourceId: PHOTO_SOURCE_ID, sourceTitle: source.title, page: null,
      section: `Original photograph ${photo.name} — OCR unverified`, lineStart: 1, lineEnd: text.split(/\r?\n/).length, text,
      image: { id: `image-${photo.sha256.slice(0, 28)}`, driveId: photo.id, sha256: photo.sha256, filename: photo.name, mimeType: "image/jpeg", ocrVerified: false } };
  });
  const sources = [...pdfs.map(pdf => pdf.source), source];
  assert.equal(new Set(sources.map(item => item.id)).size, sources.length, "Recovered source ID collision");
  const astrologyCorpus: Corpus = {
    version: 1, importedAt, snapshotDate: "", sources, passages: [...pdfs.flatMap(pdf => pdf.passages), ...passages],
    nodes: sources.map(item => ({ id: `source:${item.id}`, label: item.title, type: "document", layer: "uploaded", community: "Your uploads", sourceIds: [item.id], description: item.provenance, degree: 0 })),
    edges: [], warnings,
  };
  const requirements = parseQuestionRequirements(input.requirements ?? []);
  const pendingCloudRecords = ["brains.json", "settings.json", `brains/${ORIGINAL_ASTROLOGY_BRAIN_ID}/corpus.json`, `brains/${ORIGINAL_ASTROLOGY_BRAIN_ID}/knowledge/jobs/03478f99-4e19-4fa9-a376-899ec53f657c.json`, "drafts/*", "runs/*"];
  return {
    version: 1, completeCloudState: false, mainCorpus: structuredClone(input.mainCorpus),
    astrologyBrain: { id: RECOVERY_ASTROLOGY_BRAIN_ID, name: "Astrology (recovered sources)", description: "Original books and photograph OCR recovered locally. Original accepted cloud teachings and scan progress are pending recovery; no paid scan has been started.", createdAt: importedAt, createdBy: "recovery" },
    astrologyCorpus, originals: pdfs.map(pdf => ({ ...pdf.original, brainId: RECOVERY_ASTROLOGY_BRAIN_ID })),
    photoManifest: { version: 1, sourceId: PHOTO_SOURCE_ID, originalCount: ordered.length, uniqueCount: photos.length, sha256: source.sha256, images: passages.map(passage => passage.image!), duplicates, originalFiles: ordered.map(photo => ({ driveId: photo.id, path: photo.path, sha256: photo.sha256, bytes: photo.bytes })) },
    requirementsProfile: requirements.length ? { version: 1, jobId: "recovery-sources-unscanned", updatedAt: importedAt, entries: requirements, warnings: ["Recovered local question and topic requirements only. No extraction job or completed question coverage was recovered."] } : null,
    recoveryReport: { version: 1, kind: "source-only-recovery", completeCloudState: false, originalBrainId: ORIGINAL_ASTROLOGY_BRAIN_ID, recoveredBrainId: RECOVERY_ASTROLOGY_BRAIN_ID,
      sourceFingerprint: hash(JSON.stringify([input.mainCorpus.sources.map(item => [item.id, item.sha256]), sources.map(item => [item.id, item.sha256])])),
      counts: { mainSources: input.mainCorpus.sources.length, mainPassages: input.mainCorpus.passages.length, mainNodes: input.mainCorpus.nodes.length, mainEdges: input.mainCorpus.edges.length, astrologySources: sources.length, astrologyPassages: astrologyCorpus.passages.length, originalPhotos: ordered.length, uniquePhotos: photos.length, duplicatePhotos: duplicates.length, recoveredTeachings: 0, requirements: requirements.length },
      pendingCloudRecords, warnings },
  };
}

/** Read-only operator helper. The allowlist never loads fixture registries/jobs/corpora. */
export async function loadRecoverySourcePlan(options: { rootDirectory?: string; importedAt?: string; newPdfPath?: string } = {}): Promise<RecoverySourcePlan> {
  const root = path.resolve(options.rootDirectory ?? process.cwd()), importedAt = options.importedAt ?? RECOVERY_SOURCE_DATE;
  const readJson = async (file: string) => JSON.parse(await readFile(path.resolve(root, file), "utf8"));
  const mainCorpus = await readJson("private/corpus.json") as Corpus;
  assert.equal(mainCorpus.sources.length, 74, "Unexpected Main source inventory; review before recovery");
  const books = [
    { file: path.resolve(root, "private/brains/4201952d-07d1-4ca9-b974-ce5da4b9ee85/originals/upload-8504c3a96b79a0f19dfa.pdf"), filename: "PURE_ASTROLOGY_Nadia_Complete.pdf", sha256: "9d5fb55cf6d4f2134ed780c2694503d2dde42bdad68add60ff35acef0237161d", sourceId: "upload-8504c3a96b79a0f19dfa" },
    { file: options.newPdfPath ?? "C:/Users/olson/Downloads/Astrology book 972 pages.pdf", filename: "Astrology book 972 pages.pdf", sha256: "a821e6e585aa027d1d2a1a6dc0b6814a1169ebc6d8d75e1212e91dff72737a69", sourceId: "upload-5bd9e58b62009b1fedbc" },
  ];
  const pdfs: RecoveryPdf[] = [];
  for (const book of books) {
    const bytes = await readFile(book.file); assert.equal(hash(bytes), book.sha256, "Original book fingerprint mismatch");
    const pdf = await recoverPdfSource(bytes, book.file, book.filename, importedAt);
    assert.equal(pdf.source.id, book.sourceId, "Recovered PDF extraction differs from its known source; review before importing"); pdfs.push(pdf);
  }
  const inventory = await readJson("private/astrology-source-inventory.json") as { images: RecoveryPhotoInput[]; totalBytes: number };
  assert.equal(inventory.images.length, 1029, "Unexpected original photograph inventory");
  const photos: RecoveryPhoto[] = [];
  // Sequential reads keep the 2.85 GB original collection out of process memory.
  for (const image of inventory.images) {
    const file = path.resolve(root, `private/astrology-photos/${image.id}.jpg`);
    assert.match(image.id, /^[A-Za-z0-9_-]{20,100}$/);
    const ocr = await readJson(`private/astrology-photos/${image.id}.ocr.json`);
    photos.push(verifyRecoveryPhoto(image, ocr, await readFile(file), file));
  }
  assert.equal(photos.reduce((n, photo) => n + photo.bytes, 0), inventory.totalBytes, "Photograph inventory total mismatch");
  const requirementPaths = [
    "C:/Users/olson/.codex/attachments/ebeab1f7-4bc6-48cc-99f7-778f5cb235d0/Pasted text.txt",
    "C:/Users/olson/.codex/attachments/448d1d48-38cb-47eb-aec2-d6a88e22c6fe/Pasted text.txt",
  ];
  const requirements: string[] = [];
  for (const file of requirementPaths) {
    try { if ((await stat(file)).isFile()) requirements.push(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const plan = assembleRecoverySourcePlan({ mainCorpus, pdfs, photos, requirements, importedAt });
  assert.equal(plan.photoManifest.uniqueCount, 1028, "Unexpected original image deduplication result");
  return plan;
}
