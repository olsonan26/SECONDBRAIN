import "server-only";
import { randomUUID } from "node:crypto";
import type { Answer, Draft, Run, Workspace } from "./types";
import { getCorpus } from "./corpus";
import { retrieve, extractiveText, tokens } from "./search";
import { getSettings, publicSettings, generateGrounded } from "./model";
import { isCloud, listRecords, writeRecord } from "./storage";
import { HttpError } from "./auth";

export async function workspace(user: Workspace["user"]): Promise<Workspace> {
  const [corpus, settings, drafts, runs] = await Promise.all([getCorpus(), getSettings(), listRecords<Draft>("drafts"), listRecords<Run>("runs")]);
  return { user, sources: corpus.sources.map(({ content, ...source }) => source), nodes: corpus.nodes, edges: corpus.edges,
    stats: { sources: corpus.sources.length, passages: corpus.passages.length, nodes: corpus.nodes.length, edges: corpus.edges.length,
      characters: corpus.sources.reduce((n, s) => n + s.characters, 0), pages: corpus.sources.reduce((n, s) => n + s.pages, 0) },
    settings: publicSettings(settings), drafts: drafts.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), runs: runs.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
    warnings: corpus.warnings, snapshotDate: corpus.snapshotDate, importedAt: corpus.importedAt, persistence: isCloud() ? "cloud" : "local" };
}

export async function ask(question: string, sourceIds: string[] = []): Promise<Answer> {
  const [corpus, settings] = await Promise.all([getCorpus(), getSettings()]);
  const citations = retrieve(corpus, question, sourceIds);
  const result: Answer = { id: randomUUID(), question, text: "", mode: citations.length ? "extractive" : "not-found", citations,
    contextTokens: Math.ceil(citations.reduce((n,c) => n+c.text.length, 0) / 4), corpusTokens: Math.ceil(corpus.sources.reduce((n,s) => n+s.characters,0)/4),
    model: null, warnings: [], createdAt: new Date().toISOString() };
  if (!citations.length) {
    result.text = "I couldn't find enough matching evidence in the selected library. Try a specific topic, phrase, or document title, widen the source selection, or import the missing source.";
    return result;
  }
  if (settings.apiKey) {
    try {
      const generated = await generateGrounded(question, citations, settings);
      if (generated) { result.text = generated.text; result.mode = "model"; result.model = settings.model; result.warnings.push("AI-written synthesis passed citation and source-support checks. Review the cited passages before relying on or publishing it."); }
    } catch (error) { result.warnings.push(error instanceof HttpError ? error.message : "The model could not be reached. Showing the source evidence instead."); }
  }
  if (!result.text) {
    result.text = extractiveText(citations);
    if (!settings.apiKey) result.warnings.push("These are retrieved source excerpts. Connect a model in Settings for a written answer based on this evidence.");
  }
  return result;
}

export async function createDraft(brief: string, title: string | undefined, sourceIds: string[], author: string): Promise<Draft> {
  const [corpus, settings] = await Promise.all([getCorpus(), getSettings()]);
  const citations = retrieve(corpus, brief, sourceIds, 10);
  if (!citations.length) throw new HttpError(422, "No supporting passages were found for this brief. Add a specific topic or choose relevant sources first.");
  let text = `# ${title || brief}\n\n## Editorial brief\n\n${brief}\n\n## Evidence to build on\n\n${extractiveText(citations)}\n\n## Suggested structure\n\n- Introduce the question using the source evidence.\n- Develop the central ideas, with citations for each factual paragraph.\n- Explain connections while distinguishing source statements from interpretation.\n- Close with what the sources support and the questions they leave open.\n\n*Evidence outline: connect a model to generate article prose, then review it before publication.*`;
  let mode: Draft["mode"] = "extractive", actualTitle = title || brief;
  if (settings.apiKey) {
    const generated = await generateGrounded(brief, citations, settings, true);
    if (generated) { text = `# ${actualTitle}\n\n${generated.text}\n\n*AI-written draft: review the cited source passages before publication.*`; mode = "model"; }
  }
  const draft: Draft = { id: randomUUID(), title: actualTitle.slice(0, 180), brief, text,
    status: mode === "model" ? "draft" : "outline", citations, author, updatedAt: new Date().toISOString(), revision: 1, mode };
  await writeRecord(`drafts/${draft.id}.json`, draft);
  return draft;
}

export async function runWorkflow(kind: string, question: string, sourceIds: string[], author: string): Promise<Run> {
  const corpus = await getCorpus();
  const run: Run = { id: randomUUID(), kind, title: question || "Library health check", state: "complete", steps: [], result: "", sourceIds: [], author, createdAt: new Date().toISOString() };
  if (kind === "knowledge-audit") {
    const represented = new Set(corpus.nodes.flatMap(n => n.sourceIds));
    const unmapped = corpus.sources.filter(s => !represented.has(s.id));
    const isolated = corpus.nodes.filter(n => !n.degree);
    run.steps = [{ label: "Inspect coverage", state: "complete", detail: `${corpus.sources.length} sources and ${corpus.passages.length} searchable passages checked.` },
      { label: "Check graph provenance", state: "complete", detail: `${corpus.edges.filter(e => e.confidence !== "EXTRACTED").length} relationships are labeled as inferred or uncertain.` },
      { label: "Report gaps", state: "complete", detail: `${unmapped.length} sources without mapped concept nodes; ${isolated.length} isolated nodes.` }];
    run.result = `## Library health\n\n- ${corpus.sources.length} source documents\n- ${corpus.passages.length} searchable passages\n- ${corpus.nodes.length} concept nodes and ${corpus.edges.length} relationships\n- ${unmapped.length} sources without a concept mapping (still text-searchable)\n- ${isolated.length} isolated concept nodes\n\n## Availability\n\n${corpus.warnings.map(w => `- ${w}`).join("\n")}\n\n## Sources awaiting concept mapping\n\n${unmapped.map(s => `- ${s.title}`).join("\n") || "All sources have a mapped concept."}`;
  } else if (kind === "connection-map") {
    const terms = tokens(question);
    const selected = new Set(sourceIds);
    const matching = corpus.nodes.filter(n => (!selected.size || n.sourceIds.some(s => selected.has(s))) && terms.some(t => tokens(n.label).includes(t)));
    const ids = new Set(matching.slice(0, 12).map(n => n.id));
    const edges = corpus.edges.filter(e => ids.has(e.source) || ids.has(e.target)).slice(0, 35);
    const nodes = new Map(corpus.nodes.map(n => [n.id, n]));
    run.sourceIds = [...new Set(edges.flatMap(e => e.sourceIds))];
    run.state = edges.length ? "complete" : "needs-sources";
    run.steps = [{ label: "Find concepts", state: "complete", detail: `${matching.length} matching concepts.` }, { label: "Trace relationships", state: "complete", detail: `${edges.length} relationships retrieved with provenance labels.` }];
    run.result = edges.length ? `## Connections for ${question}\n\n${edges.map(e => `- **${nodes.get(e.source)?.label}** → ${e.relation.replaceAll("_", " ")} → **${nodes.get(e.target)?.label}** (${e.confidence.toLowerCase()}, confidence ${e.score})`).join("\n")}\n\nInferred relationships are exploration leads, not additional source evidence.` : "No matching connected concepts were found. Try another term from the graph or import the relevant material.";
  } else {
    const answer = await ask(question, sourceIds);
    run.sourceIds = [...new Set(answer.citations.map(c => c.sourceId))];
    run.state = answer.mode === "model" ? "complete" : answer.mode === "not-found" ? "needs-sources" : "needs-model";
    run.steps = [{ label: "Retrieve evidence", state: "complete", detail: `${answer.citations.length} passages from ${run.sourceIds.length} sources.` },
      { label: "Prepare synthesis", state: answer.mode === "model" ? "complete" : "skipped", detail: answer.mode === "model" ? "Written using the connected model." : "Source evidence is ready. Model synthesis is not enabled or lacks sufficient evidence." },
      { label: "Validate citations", state: "complete", detail: "Source references resolve to stored passages. Model paragraphs require matching supporting quotations." }];
    run.result = `${kind === "article-plan" ? `## Article evidence plan\n\nBrief: ${question}\n\n` : ""}${answer.text}\n\n${answer.warnings.map(w => `*${w}*`).join("\n\n")}`;
  }
  await writeRecord(`runs/${run.id}.json`, run);
  return run;
}
