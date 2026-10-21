import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { extractText } from "unpdf";

// Read-only to originals. All reports and recovered text remain in ignored private/.
async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: audit-book-sources.ts PDF [inventory.json]");
  const bytes = await readFile(input);
  const extracted = await extractText(new Uint8Array(bytes), { mergePages: false });
  const pages = extracted.text.map((text, index) => {
    const markers = [...text.matchAll(/(?:\bPage\s+(\d{1,4})\b|(?:^|\n)[^\n]{0,85}[.·•]\s*(\d{1,4})\s*(?:\n|$))/g)]
      .map(match => ({ printedPage: Number(match[1] || match[2]), offset: match.index, marker: match[0].trim() }));
    const flags = [
      ...[...text.matchAll(/\[(?:Diagram|Image|Illustration|Chart|Table|Figure|Photo)[^\]]{0,1500}\]/gi)].map(match => ({ kind: "visual-placeholder", offset: match.index, text: match[0] })),
      ...[...text.matchAll(/Would you like[^\n]{0,400}|Here(?:'s| is) (?:the |a )?(?:transcription|transcript)[^\n]{0,200}/gi)].map(match => ({ kind: "possible-transcription-artifact", offset: match.index, text: match[0] })),
    ];
    return { pdfPage: index + 1, printedPageCandidates: markers, flags, characters: text.length,
      sha256: createHash("sha256").update(text).digest("hex"), text };
  });
  const inventory = process.argv[3] ? JSON.parse(await readFile(process.argv[3], "utf8")) : undefined;
  const images: { id: string; batch: string; name: string; bytes: number }[] = inventory?.images || [];
  const grouped = new Map<string, number[]>();
  for (const page of pages) grouped.set(page.sha256, [...(grouped.get(page.sha256) || []), page.pdfPage]);
  const report = {
    version: 1, input: resolve(input), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    pdfPages: pages.length, extractedCharacters: pages.reduce((sum, page) => sum + page.characters, 0),
    imageFiles: images.length, uniqueImageIds: new Set(images.map(image => image.id)).size,
    imagesByBatch: Object.fromEntries([...new Set(images.map(image => image.batch))].map(batch => [batch, images.filter(image => image.batch === batch).length])),
    exactDuplicateTextPages: [...grouped.values()].filter(group => group.length > 1),
    flaggedPages: pages.filter(page => page.flags.length).map(({ pdfPage, flags }) => ({ pdfPage, flags })),
    limitations: ["Printed page markers are candidates, not verified photo mappings.", "Image inventory is metadata only; image bytes and printed pages have not been deduplicated or OCR verified.", "No source content is removed or changed. Flags require visual verification.", "Counts alone cannot establish complete book coverage."],
    pages,
  };
  const output = resolve("private/astrology-page-audit.json");
  await mkdir(resolve("private"), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, pdfPages: report.pdfPages, characters: report.extractedCharacters, imageFiles: report.imageFiles, flaggedPages: report.flaggedPages.length, duplicateTextGroups: report.exactDuplicateTextPages.length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Source audit failed"); process.exitCode = 1; });
