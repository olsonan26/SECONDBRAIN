import "server-only";
import type { Corpus } from "./types";
import { readRecord } from "./storage";

let cached: { value: Corpus; at: number } | null = null;
export function invalidateCorpus() { cached = null; }
export async function getCorpus(): Promise<Corpus> {
  if (cached && Date.now() - cached.at < 15_000) return cached.value;
  const record = await readRecord<Corpus>("corpus.json");
  const value = record?.value ?? { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [], nodes: [], edges: [], warnings: ["Your private library has not been imported yet. Import a source or connect private storage."] };
  cached = { value, at: Date.now() };
  return value;
}
