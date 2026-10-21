import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const words = (text: string) => new Set(text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) || []);
async function main() {
  const audit = JSON.parse(await readFile("private/astrology-page-audit.json", "utf8")) as { pages: { pdfPage: number; text: string; printedPageCandidates: unknown[] }[] };
  const pages = audit.pages.map(page => ({ ...page, words: words(page.text) }));
  const frequency = new Map<string, number>();
  for (const page of pages) for (const word of page.words) frequency.set(word, (frequency.get(word) || 0) + 1);
  const weight = (word: string) => Math.log(1 + pages.length / (1 + (frequency.get(word) || 0)));
  const norm = (set: Set<string>) => Math.sqrt([...set].reduce((sum, word) => sum + weight(word) ** 2, 0));
  const norms = pages.map(page => norm(page.words));
  const root = resolve("private/astrology-photos");
  const files = (await readdir(root)).filter(file => file.endsWith(".ocr.json"));
  const results = [];
  for (const file of files) {
    const image = JSON.parse(await readFile(resolve(root, file), "utf8"));
    const terms = words(image.ocr.text), magnitude = norm(terms);
    const matches = pages.map((page, index) => ({ pdfPage: page.pdfPage, printedPageCandidates: page.printedPageCandidates, score: [...terms].reduce((sum, word) => sum + (page.words.has(word) ? weight(word) ** 2 : 0), 0) / Math.max(1e-9, magnitude * norms[index]) })).sort((a, b) => b.score - a.score).slice(0, 3);
    const best = matches[0], runnerUp = matches[1];
    results.push({ imageId: image.id, name: image.name, batch: image.batch, sha256: image.sha256, ocrCharacters: image.ocr.text.length, printedPageCandidates: image.printedPageCandidates, matches, status: best.score > .4 && best.score > runnerUp.score * 1.1 ? "candidate-match" : "needs-review", verified: false });
  }
  const hashes = new Map<string, string[]>();
  for (const result of results) hashes.set(result.sha256, [...(hashes.get(result.sha256) || []), result.imageId]);
  const matched = new Set(results.filter(result => result.status === "candidate-match").map(result => result.matches[0].pdfPage));
  const report = { version: 1, ocrImages: results.length, candidateMatches: results.filter(result => result.status === "candidate-match").length, needsReview: results.filter(result => result.status === "needs-review").length, pdfPagesWithCandidatePhoto: matched.size, pdfPagesWithoutCandidatePhoto: pages.filter(page => !matched.has(page.pdfPage)).map(page => page.pdfPage), exactDuplicateImages: [...hashes.values()].filter(ids => ids.length > 1), limitations: ["Automated lexical alignment proposes candidates only; it does not prove that diagrams or printed pages are complete.", "Reflowed PDF pages may correspond to multiple printed pages and multiple photographs.", "OCR is unverified and cannot replace the original image for numbers, formulas, glyphs or diagram relationships."], results };
  await writeFile("private/astrology-photo-alignment.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ocrImages: report.ocrImages, candidateMatches: report.candidateMatches, needsReview: report.needsReview, pdfPagesWithCandidatePhoto: matched.size, exactDuplicateGroups: report.exactDuplicateImages.length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Alignment failed"); process.exitCode = 1; });
