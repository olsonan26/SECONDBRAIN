import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { brainKey } from "../src/lib/brain-scope";
import { requireBrain } from "../src/lib/brains";
import { getCorpus } from "../src/lib/corpus";
import { knowledgePassageHash, type KnowledgeJob } from "../src/lib/knowledge";
import { readRecord, updateRecord, writeRecord } from "../src/lib/storage";
import type { Corpus, Passage, Source } from "../src/lib/types";

// Explicit operator migration, never a public API. Preserve originals, the pilot,
// and the SAME cumulative budget; archive the previous source audit first.
async function main() {
  const [brainId, jobId, confirmation] = process.argv.slice(2);
  assert.ok(brainId && jobId && confirmation === "--connect-originals");
  assert.notEqual(brainId, "main"); await requireBrain(brainId);
  const inventory = JSON.parse(await readFile("private/astrology-source-inventory.json", "utf8"));
  const unique = new Map<string, { id: string; name: string; text: string; sha: string }>();
  const duplicates: { duplicate: string; original: string; sha256: string }[] = [];
  for (const image of [...inventory.images].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const ocr = JSON.parse(await readFile(`private/astrology-photos/${image.id}.ocr.json`, "utf8"));
    assert.match(ocr.sha256, /^[a-f0-9]{64}$/);
    const bytes = await readFile(`private/astrology-photos/${image.id}.jpg`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ocr.sha256);
    if (unique.has(ocr.sha256)) { duplicates.push({ duplicate: image.id, original: unique.get(ocr.sha256)!.id, sha256: ocr.sha256 }); continue; }
    unique.set(ocr.sha256, { id: image.id, name: image.name, text: ocr.ocr.text || "[Image-only page: inspect the attached original photograph.]", sha: ocr.sha256 });
  }
  assert.equal(inventory.images.length, 1029); assert.equal(unique.size, 1028);
  const photos = [...unique.values()], sourceId = "astrology-original-page-photographs";
  const source: Source = { id: sourceId, title: "Astrology — original page photographs", filename: "Original book photographs (Batches 1–8)", layer: "uploaded", format: "photo-book", characters: photos.reduce((n, p) => n + p.text.length, 0), pages: photos.length, sha256: createHash("sha256").update(photos.map(p => p.sha).join("\n")).digest("hex"), importedAt: new Date().toISOString(), provenance: "1,029 inventoried originals; one byte-identical duplicate retained in the source audit, 1,028 unique page images. Windows OCR is an unverified search aid. Original SHA256-verified photographs are attached to every extraction, omission-review and support-verification call. Printed page mapping is not assumed from file order.", originalAvailable: false };
  const passages: Passage[] = photos.map(photo => ({ id: `photo-${photo.sha.slice(0, 28)}`, sourceId, sourceTitle: source.title, page: null, section: `Original photograph ${photo.name} — OCR unverified`, lineStart: 1, lineEnd: photo.text.split(/\r?\n/).length, text: photo.text, image: { id: `image-${photo.sha.slice(0, 28)}`, driveId: photo.id, sha256: photo.sha, filename: photo.name, mimeType: "image/jpeg", ocrVerified: false } }));
  const key = brainKey(brainId, `knowledge/jobs/${jobId}.json`), saved = await readRecord<KnowledgeJob>(key);
  assert.ok(saved && saved.value.brainId === brainId);
  if (saved.value.sourceIds.includes(sourceId)) { console.log(JSON.stringify({ alreadyConnected: true, images: saved.value.imagePassageIds?.length, costUsd: saved.value.costUsd, budgetUsd: saved.value.budgetUsd })); return; }
  assert.equal(saved.value.stage, "paused"); assert.ok(saved.value.batches.every(batch => !batch.lease)); assert.equal(saved.value.scanPass ?? 1, 1);
  const history = brainKey(brainId, `knowledge/history/${jobId}-before-photo-upgrade.json`);
  if (!(await readRecord(history))) await writeRecord(history, saved.value);
  const before = await getCorpus(brainId);
  await updateRecord<Corpus>(brainKey(brainId, "corpus.json"), before, corpus => {
    if (corpus.sources.some(item => item.id === sourceId)) { assert.equal(corpus.sources.find(item => item.id === sourceId)!.sha256, source.sha256); return corpus; }
    return { ...corpus, sources: [...corpus.sources, source], passages: [...corpus.passages, ...passages], nodes: [...corpus.nodes, { id: `source:${sourceId}`, label: source.title, type: "document", layer: "uploaded", community: "Your uploads", sourceIds: [sourceId], description: source.provenance, degree: 0 }], warnings: [...corpus.warnings.filter(w => !w.includes("not yet indexed") && !w.includes("not yet connected")), "Original photographs are now connected. OCR may misread numbers or glyphs; extraction checks the actual attached images. Existing PDF text is retained, but is not a verified complete transcription of the photo book."] };
  });
  await writeRecord(brainKey(brainId, "knowledge/original-photo-manifest.json"), { sourceId, images: passages.map(p => p.image), duplicates, originalCount: inventory.images.length, sha256: source.sha256 });
  await updateRecord(key, saved.value, job => {
    assert.equal(job.stage, "paused"); assert.ok(job.batches.every(batch => !batch.lease)); assert.equal(job.costUsd, saved.value.costUsd);
    const priority = "1-OvR9q2Zf3LZAimp-rLguz3LjZhXx42z";
    const ordered = [...passages].sort((a, b) => Number(b.image!.driveId === priority) - Number(a.image!.driveId === priority));
    job.sourceIds = [sourceId]; job.imagePassageIds = passages.map(p => p.id); job.passageHashes = Object.fromEntries(passages.map(p => [p.id, knowledgePassageHash(p)]));
    job.passages = passages.map(p => ({ passageId: p.id, sourceId, page: p.page, disposition: "pending", reason: "Awaiting image-backed extraction and two independent checks.", nodeIds: [] }));
    job.batches = ordered.map((p, i) => ({ id: `original-photo-${i}`, passageIds: [p.id], phase: "extract", state: "pending", attempts: 0, revision: 0 }));
    job.warnings = ["All 1,028 unique original page photographs are connected; OCR is an unverified search aid, not a substitute for reading the attached image.", "The previous text-only pilot and its detailed warnings were archived. Its accepted nodes and cumulative spending remain preserved.", "Three whole-book passes do not guarantee perfect completeness. Genuine unreadable details remain unresolved rather than guessed. The same $10 cumulative cap still applies."];
    job.error = undefined; job.updatedAt = new Date().toISOString(); job.estimatedTotalCostUsd = 1028 * 3 * 12000 * 1.4 / 1e6;
    job.activity = [...(job.activity ?? []), { at: job.updatedAt, pass: 1, phase: "source-upgrade", message: "Connected 1,028 unique original photographs to the website pipeline. Preserved pilot knowledge, all prior costs and the existing $10 cap. Earlier text-only audit archived; no paid call started by this migration.", passageIds: [] }];
    return job;
  });
  await updateRecord<{ sources: Record<string, string>; creating: Record<string, KnowledgeJob> }>(brainKey(brainId, "knowledge/source-claims.json"), { sources: {}, creating: {} }, registry => { assert.ok(!registry.sources[sourceId] || registry.sources[sourceId] === jobId); registry.sources[sourceId] = jobId; return registry; });
  console.log(JSON.stringify({ connected: passages.length, duplicateImages: duplicates.length, retainedTeachingNodes: before.nodes.filter(n => n.type === "teaching").length, costUsd: saved.value.costUsd, budgetUsd: saved.value.budgetUsd, paused: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Photo connection failed"); process.exitCode = 1; });
