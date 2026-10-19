import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Confidence, Corpus, GraphEdge, GraphNode, Passage, Source } from "../src/lib/types";

type Raw = Record<string, unknown>;
type SourceLayer = "advanced" | "foundation";
interface BundleSource { path: string; name: string; content: string }
interface TextLine { text: string; start: number; end: number }

export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
function record(value: unknown): Raw { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Raw : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === "string" ? value : value == null ? "" : String(value); }
function portableBasename(value: string): string { return value.replace(/\\/g, "/").split("/").pop() ?? value; }
function normalized(value: string): string { return value.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US"); }

export function originalSourceName(source: BundleSource): string {
  const header = source.content.match(/^Source\s+(?:file|pdf|path):\s*(.+)$/im)?.[1]?.trim();
  const converted = source.content.match(/^<!--\s*converted from\s+(.+?)\s*-->/im)?.[1]?.trim();
  return header || converted || source.name.replace(/\.md$/i, "");
}

function textLines(content: string): TextLine[] {
  const result: TextLine[] = [];
  let start = 0;
  for (const part of content.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!part[0]) continue;
    result.push({ text: part[0].replace(/\r?\n$/, ""), start, end: start + part[0].length });
    start += part[0].length;
  }
  return result;
}
function lineAt(lines: TextLine[], offset: number): number {
  let low = 0, high = lines.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high) + 1;
}
function trimRange(content: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(content[start])) start++;
  while (end > start && /\s/.test(content[end - 1])) end--;
  return [start, end];
}
function chunkBoundary(content: string, start: number, end: number, maximum: number): number {
  const limit = Math.min(end, start + maximum);
  const minimum = start + Math.min(1100, Math.floor(maximum * 0.65));
  const part = content.slice(start, limit);
  for (const pattern of [/\n\s*\n/g, /\n/g, /[.!?][ \t]+/g, /\s+/g]) {
    let chosen = -1;
    for (const match of part.matchAll(pattern)) {
      const offset = start + (match.index ?? 0) + match[0].length;
      if (offset >= minimum && offset <= limit) chosen = offset;
    }
    if (chosen > start) return chosen;
  }
  return limit;
}
function overlapStart(content: string, start: number, end: number): number {
  // Reuse a whole short paragraph or sentence, never an arbitrary partial word.
  const tailStart = Math.max(start + 1, end - 150);
  const tail = content.slice(tailStart, end);
  for (const pattern of [/\n\s*\n/g, /[.!?][ \t]+/g]) {
    for (const match of tail.matchAll(pattern)) {
      const candidate = tailStart + (match.index ?? 0) + match[0].length;
      if (candidate < end - 20 && content.slice(candidate, end).trim()) return candidate;
    }
  }
  return end;
}

/** Passages are exact source substrings, with original 1-based line coordinates. */
export function createPassages(source: Source, content: string, maximum = 1900): Passage[] {
  if (maximum < 200) throw new Error("Passage maximum must be at least 200 characters.");
  const lines = textLines(content), passages: Passage[] = [];
  let page: number | null = null, section = "", spanStart = 0;
  const flush = (spanEnd: number) => {
    let [start, end] = trimRange(content, spanStart, spanEnd);
    while (start < end) {
      const rawEnd = end - start > maximum ? chunkBoundary(content, start, end, maximum) : end;
      const [chunkStart, chunkEnd] = trimRange(content, start, rawEnd);
      const body = content.slice(chunkStart, chunkEnd);
      if (/[\p{L}\p{N}]/u.test(body)) passages.push({
        id: `passage_${sha256(`${source.id}\0${chunkStart}\0${chunkEnd}`).slice(0, 24)}`,
        sourceId: source.id, sourceTitle: source.title, page, section,
        lineStart: lineAt(lines, chunkStart), lineEnd: lineAt(lines, Math.max(chunkStart, chunkEnd - 1)), text: body,
      });
      if (rawEnd >= end) break;
      start = trimRange(content, Math.max(start + 1, overlapStart(content, start, rawEnd)), end)[0];
    }
  };
  for (const line of lines) {
    const pageMatch = line.text.match(/^#{1,6}\s+Page\s+(\d+)\s*$/i);
    const heading = line.text.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    const metadata = /^Source\s+(?:file|pdf|path):/i.test(line.text) || /^<!--\s*converted from\s+/i.test(line.text);
    if (pageMatch || heading || metadata) {
      flush(line.start);
      spanStart = line.end;
      if (pageMatch) { page = Number(pageMatch[1]); section = ""; }
      else if (heading) section = heading[1].trim();
    }
  }
  flush(content.length);
  return passages;
}

function aliases(value: string): string[] {
  const full = normalized(value), base = portableBasename(full);
  const candidates = new Set([full, base]);
  for (const item of [...candidates]) {
    const withoutMarkdown = item.replace(/\.md$/i, "");
    candidates.add(withoutMarkdown);
    candidates.add(withoutMarkdown.replace(/\.(?:pdf|docx?|txt)$/i, ""));
    candidates.add(withoutMarkdown.replace(/_[a-f0-9]{8,64}$/i, ""));
    if (item.startsWith("other eye opeing things - ")) {
      for (const alias of aliases(item.slice("other eye opeing things - ".length))) candidates.add(alias);
    }
  }
  return [...candidates].filter(Boolean);
}
function sourceReferences(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap(sourceReferences) : typeof value === "string" && value.trim() ? [value.trim()] : [];
}

export function buildCorpus(input: unknown, importedAt = new Date().toISOString()): Corpus {
  const bundle = record(input), sourceLayers = record(bundle.source_layers), graphData = record(bundle.graph_data);
  const snapshotDate = text(bundle.created_at_utc).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "2026-05-14";
  const warnings = new Set<string>(), sources: Source[] = [], passages: Passage[] = [];
  const sourceIndex = new Map<string, Set<string>>();
  for (const layer of ["foundation", "advanced"] as const) {
    for (const [index, value] of list(sourceLayers[`${layer}_sources`]).entries()) {
      const item = record(value);
      if (typeof item.content !== "string" || !item.content.trim()) { warnings.add(`Skipped empty or invalid ${layer} source at index ${index}.`); continue; }
      const original: BundleSource = {
        path: text(item.path) || `${layer}/${text(item.name) || index}`,
        name: text(item.name) || portableBasename(text(item.path)) || `Source ${index + 1}`, content: item.content,
      };
      const originalName = originalSourceName(original), filename = portableBasename(originalName);
      const format = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "md";
      const pageNumbers = [...original.content.matchAll(/^#{1,6}\s+Page\s+(\d+)\s*$/gim)].map(match => Number(match[1]));
      const source: Source = {
        id: `source_${sha256(`${layer}\0${normalized(original.path)}`).slice(0, 24)}`,
        title: filename.replace(/\.(?:md|pdf|docx?|txt)$/i, ""), filename, layer, format,
        characters: original.content.length, pages: new Set(pageNumbers).size, sha256: sha256(original.content), importedAt,
        provenance: `Recovered verbatim from the Graph Brain Studio bundle snapshot dated ${snapshotDate}. The original ${format.toUpperCase()} file is cloud-only and has not been verified against this extraction.`,
        originalAvailable: false, content: original.content,
      };
      if (sources.some(existing => existing.id === source.id)) throw new Error(`Duplicate source path in ${layer}: ${original.path}`);
      sources.push(source);
      passages.push(...createPassages(source, original.content));
      for (const candidate of [original.path, original.name, originalName, filename, source.title]) for (const alias of aliases(candidate)) {
        const key = `${layer}\0${alias}`, ids = sourceIndex.get(key) ?? new Set<string>();
        ids.add(source.id); sourceIndex.set(key, ids);
      }
    }
  }
  if (!sources.length) throw new Error("Bundle contains no readable foundation_sources or advanced_sources.");
  const matchSources = (value: unknown, layer: SourceLayer, context: string): string[] => {
    const ids = new Set<string>();
    for (const reference of sourceReferences(value)) {
      let found: Set<string> | undefined;
      for (const alias of aliases(reference)) { const matches = sourceIndex.get(`${layer}\0${alias}`); if (matches?.size) { found = matches; break; } }
      if (!found) warnings.add(`Unmapped ${layer} source reference: ${reference} (${context}).`);
      else if (found.size > 1) warnings.add(`Ambiguous ${layer} source reference: ${reference} (${context}); no source ID assigned.`);
      else for (const id of found) ids.add(id);
    }
    return [...ids].sort();
  };
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], nodesById = new Map<string, GraphNode>(), edgeOccurrences = new Map<string, number>();
  for (const layer of ["foundation", "advanced"] as const) {
    const graph = record(graphData[`${layer}_graph_json`]);
    for (const value of list(graph.nodes)) {
      const raw = record(value);
      if (raw.id == null || text(raw.id) === "") { warnings.add(`Skipped ${layer} graph node without an ID.`); continue; }
      const id = `${layer}:${text(raw.id)}`;
      if (nodesById.has(id)) { warnings.add(`Skipped duplicate graph node ID: ${id}.`); continue; }
      const node: GraphNode = {
        id, label: text(raw.label) || text(raw.id), type: text(raw.file_type) || text(raw.type) || "concept", layer,
        community: text(raw.community) || "unassigned", sourceIds: matchSources(raw.source_file ?? raw.source_files, layer, `node ${text(raw.id)}`),
        description: text(raw.description) || text(raw.summary), degree: 0,
      };
      nodes.push(node); nodesById.set(id, node);
    }
    for (const value of list(graph.links ?? graph.edges)) {
      const raw = record(value), source = `${layer}:${text(raw.source)}`, target = `${layer}:${text(raw.target)}`;
      if (!nodesById.has(source) || !nodesById.has(target)) { warnings.add(`Skipped ${layer} graph edge with missing endpoint: ${text(raw.source)} -> ${text(raw.target)}.`); continue; }
      const rawConfidence = text(raw.confidence).toUpperCase();
      const confidence: Confidence = ["EXTRACTED", "INFERRED", "AMBIGUOUS"].includes(rawConfidence) ? rawConfidence as Confidence : "AMBIGUOUS";
      if (confidence !== rawConfidence) warnings.add(`Unknown confidence on ${layer} graph edge ${source} -> ${target}; marked AMBIGUOUS.`);
      const rawScore = Number(raw.confidence_score ?? raw.score);
      const score = Number.isFinite(rawScore) ? rawScore : confidence === "EXTRACTED" ? 1 : confidence === "INFERRED" ? 0.5 : 0;
      const sourceIds = matchSources(raw.source_file ?? raw.source_files, layer, `edge ${text(raw.source)} -> ${text(raw.target)}`), relation = text(raw.relation) || "related_to";
      const fingerprint = sha256(JSON.stringify([layer, text(raw.id), source, target, relation, confidence, score, sourceIds]));
      const occurrence = edgeOccurrences.get(fingerprint) ?? 0; edgeOccurrences.set(fingerprint, occurrence + 1);
      edges.push({ id: `edge_${fingerprint.slice(0, 24)}_${occurrence}`, source, target, relation, confidence, score, sourceIds });
      nodesById.get(source)!.degree++; nodesById.get(target)!.degree++;
    }
  }
  warnings.add(`Recovered snapshot: ${snapshotDate}. Original files are unavailable locally; source extraction text is preserved, but original bytes have not been verified.`);
  if (edges.some(edge => edge.confidence !== "EXTRACTED")) warnings.add("Graph relationships include inferred or ambiguous claims; use source passages as evidence and retain graph confidence labels.");
  return { version: 1, importedAt, snapshotDate, sources, passages, nodes, edges, warnings: [...warnings].sort() };
}

export async function importBrainBundle(bundlePath: string, outputPath?: string): Promise<Corpus> {
  if (!isAbsolute(bundlePath)) throw new Error("--bundle must be an absolute path.");
  const corpus = buildCorpus(JSON.parse(await readFile(bundlePath, "utf8")));
  if (outputPath) { await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, JSON.stringify(corpus), "utf8"); }
  return corpus;
}
export async function runCli(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help")) { console.log("Usage: node --import tsx scripts/import-brain.ts --bundle <absolute-path> [--output private/corpus.json]"); return; }
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--bundle", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Invalid argument: ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  const bundlePath = values.get("--bundle");
  if (!bundlePath) throw new Error("Missing --bundle <absolute-path>.");
  const outputPath = resolve(values.get("--output") ?? "private/corpus.json"), corpus = await importBrainBundle(bundlePath, outputPath);
  console.log(JSON.stringify({ output: outputPath, snapshotDate: corpus.snapshotDate, sources: corpus.sources.length, passages: corpus.passages.length, nodes: corpus.nodes.length, edges: corpus.edges.length, unmappedReferences: corpus.warnings.filter(warning => /^(Unmapped|Ambiguous .* source reference)/.test(warning)).length, warnings: corpus.warnings }, null, 2));
}
// Imports from tests or the application never execute the command-line importer.
if (process.argv[1] && /(?:^|[\\/])scripts[\\/]import-brain\.(?:ts|js)$/.test(process.argv[1])) {
  runCli().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
