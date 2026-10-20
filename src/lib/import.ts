import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import type { Corpus, Passage, Source, GraphNode, GraphEdge } from "./types";
import { HttpError } from "./auth";
import { updateRecord, writeOriginal } from "./storage";
import { invalidateCorpus, getCorpus } from "./corpus";
import { createPassages } from "../../scripts/import-brain";
import { brainKey, MAIN_BRAIN_ID } from "./brain-scope";
import { MAX_EXTRACTED_CHARACTERS, MAX_UPLOAD_BYTES, uploadValidationError } from "./import-limits";

export async function importFile(file: File, brainId = MAIN_BRAIN_ID) {
  const invalid = uploadValidationError(file);
  if (invalid) throw new HttpError(file.size > MAX_UPLOAD_BYTES ? 413 : 422, invalid);
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = file.name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 220);
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "json") return importGraph(JSON.parse(bytes.toString("utf8")), brainId);
  let content: string;
  if (ext === "pdf") {
    const parsed = await extractText(new Uint8Array(bytes), { mergePages: false });
    content = parsed.text.map((text, i) => `## Page ${i + 1}\n\n${text}`).join("\n\n");
  } else if (ext === "docx") content = (await mammoth.extractRawText({ buffer: bytes })).value;
  else if (["txt", "md", "markdown"].includes(ext || "")) content = bytes.toString("utf8").replace(/^\uFEFF/, "");
  else throw new HttpError(415, "Choose a text, Markdown, PDF, Word .docx, or Graphify JSON file.");
  if (content.replace(/#+\s*Page\s*\d+/g, "").trim().length < 40) throw new HttpError(422, "No readable text was found. Scanned documents need OCR before import.");
  if (content.length > MAX_EXTRACTED_CHARACTERS) throw new HttpError(413, "This document contains over 5 million characters of text. Split it into sections before importing.");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const source: Source = { id: `upload-${sha256.slice(0, 20)}`, title: filename.replace(/\.[^.]+$/, ""), filename, layer: "uploaded", format: ext || "txt",
    characters: content.length, pages: [...content.matchAll(/^#{1,6}\s+Page\s+\d+/gmi)].length,
    sha256, importedAt: new Date().toISOString(), provenance: "Uploaded directly to this workspace; text extracted locally by the server.", originalAvailable: true, content };
  const passages = createPassages(source, content);
  const fallback = await getCorpus(brainId);
  if (fallback.sources.some(s => s.sha256 === sha256)) throw new HttpError(409, "This exact source is already in your library.");
  await writeOriginal(source.id, source.format, bytes, brainId);
  const updated = await updateRecord<Corpus>(brainKey(brainId, "corpus.json"), fallback, corpus => {
    if (corpus.sources.some(s => s.sha256 === sha256)) throw new HttpError(409, "This exact source is already in your library.");
    const docNode: GraphNode = { id: `source:${source.id}`, label: source.title, type: "document", layer: "uploaded", community: "Your uploads", sourceIds: [source.id], description: "Source document. Import a concept graph to add semantic relationships.", degree: 0 };
    return { ...corpus, sources: [...corpus.sources, source], passages: [...corpus.passages, ...passages], nodes: [...corpus.nodes, docNode], importedAt: source.importedAt };
  });
  invalidateCorpus(brainId);
  return { source: { ...source, content: undefined }, passages: passages.length, totalSources: updated.sources.length };
}

async function importGraph(input: unknown, brainId: string) {
  const data = input as { nodes?: unknown[]; links?: unknown[]; edges?: unknown[] };
  if (!Array.isArray(data?.nodes) || data.nodes.length > 10_000 || !Array.isArray(data.links ?? data.edges)) throw new HttpError(422, "Choose a Graphify graph.json export with nodes and links.");
  const prefix = `graph-${randomUUID().slice(0, 8)}:`;
  const corpus = await getCorpus(brainId);
  const map = new Map<string, string>();
  const sourceIds = (file: unknown) => typeof file === "string" ? corpus.sources.filter(s => file.replace(/\\/g,"/").toLowerCase().includes(s.filename.toLowerCase().replace(/\.(pdf|txt|docx|md)$/i,""))).map(s => s.id) : [];
  const nodes: GraphNode[] = data.nodes.map((raw: unknown) => {
    const n = raw as Record<string, unknown>; const id = String(n.id); map.set(id, prefix + id);
    return { id: prefix + id, label: String(n.label || n.id).slice(0,220), type: String(n.file_type || "concept"), layer: "uploaded", community: String(n.community ?? "Imported graph"), sourceIds: sourceIds(n.source_file), description: String(n.description || n.rationale || "").slice(0,5000), degree: 0 };
  });
  const edges: GraphEdge[] = (data.links ?? data.edges ?? []).slice(0,30_000).flatMap((raw: unknown, i) => {
    const e = raw as Record<string, unknown>; const a = map.get(String(e.source)), b = map.get(String(e.target)); if(!a || !b) return [];
    return [{ id: prefix + i, source: a, target: b, relation: String(e.relation || "related"), confidence: e.confidence === "EXTRACTED" || e.confidence === "INFERRED" ? e.confidence : "AMBIGUOUS",
      score: typeof e.confidence_score === "number" ? Math.max(0, Math.min(1,e.confidence_score)) : e.confidence === "EXTRACTED" ? 1 : 0.2, sourceIds: sourceIds(e.source_file) } satisfies GraphEdge];
  });
  const degree = new Map<string, number>(); for(const e of edges){degree.set(e.source,(degree.get(e.source) ?? 0)+1);degree.set(e.target,(degree.get(e.target) ?? 0)+1);} for(const n of nodes)n.degree=degree.get(n.id) ?? 0;
  await updateRecord<Corpus>(brainKey(brainId, "corpus.json"), corpus, old => ({ ...old, nodes: [...old.nodes, ...nodes], edges: [...old.edges, ...edges] }));
  invalidateCorpus(brainId); return { nodes: nodes.length, edges: edges.length, warning: "Graph imported. Source documents must also be present for passage-level answers." };
}
