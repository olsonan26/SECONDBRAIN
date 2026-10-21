import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import assert from "node:assert/strict";
import { importFile } from "../src/lib/import";
import { requireBrain } from "../src/lib/brains";
import { getCorpus } from "../src/lib/corpus";

// Run only with explicit operator intent, --conditions=react-server and a
// private environment. Original bytes and corpus updates use normal CAS storage.
async function main() {
  const [path, brainId, confirm] = process.argv.slice(2);
  assert.ok(path && brainId && confirm === "--import", "Usage: import-local-book.ts PDF BRAIN_UUID --import");
  assert.notEqual(brainId, "main", "Book ingestion must target its explicitly selected separate brain.");
  const brain = await requireBrain(brainId);
  const before = await getCorpus(brainId);
  const bytes = await readFile(path);
  const result = await importFile(new File([bytes], basename(path), { type: "application/pdf" }), brainId, true);
  assert.ok("source" in result, "A PDF import must return a source, not a graph.");
  const after = await getCorpus(brainId);
  assert.equal(after.sources.length, before.sources.length + 1);
  assert.ok(before.sources.every(source => after.sources.some(saved => saved.id === source.id && saved.sha256 === source.sha256)), "An existing source was altered.");
  console.log(JSON.stringify({ brain: brain.name, sourceId: result.source.id, pages: result.source.pages, passages: result.passages, sourcesBefore: before.sources.length, sourcesAfter: after.sources.length, originalPreserved: result.source.originalAvailable }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Local book import failed"); process.exitCode = 1; });
