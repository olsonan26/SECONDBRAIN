import "server-only";
import type { Corpus } from "./types";
import { readRecord } from "./storage";
import { brainKey, MAIN_BRAIN_ID } from "./brain-scope";

const cache = new Map<string, { value: Corpus; at: number }>();
const inFlight = new Map<string, Promise<Corpus>>();
export function invalidateCorpus(brainId = MAIN_BRAIN_ID) { cache.delete(brainId); inFlight.delete(brainId); }
export async function getCorpus(brainId = MAIN_BRAIN_ID): Promise<Corpus> {
  const key = brainKey(brainId, "corpus.json");
  const cached = cache.get(brainId);
  if (cached && Date.now() - cached.at < 15_000) return cached.value;
  const pending = inFlight.get(brainId);
  if (pending) return pending;
  let loading!: Promise<Corpus>;
  loading = (async () => {
    const record = await readRecord<Corpus>(key);
    const value = record?.value ?? { version: 1, importedAt: "", snapshotDate: "", sources: [], passages: [], nodes: [], edges: [], warnings: ["This brain has no sources yet. Import knowledge into this brain to enable search and writing."] };
    // An invalidation or newer load must win over an older in-flight result.
    if (inFlight.get(brainId) === loading) {
      if (cache.size >= 50) cache.delete(cache.keys().next().value!);
      cache.set(brainId, { value, at: Date.now() });
    }
    return value;
  })();
  inFlight.set(brainId, loading);
  try { return await loading; }
  finally { if (inFlight.get(brainId) === loading) inFlight.delete(brainId); }
}
