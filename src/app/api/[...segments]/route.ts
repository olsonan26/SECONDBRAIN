import { z } from "zod";
import { parseJsonRequest } from "@/lib/json-request";
import { getSession, requireUser, checkOrigin, HttpError, login } from "@/lib/auth";
import { workspace, ask, createDraft, runWorkflow } from "@/lib/workspace";
import { getCorpus } from "@/lib/corpus";
import { saveSettings } from "@/lib/model";
import { importFile } from "@/lib/import";
import { updateRecord, readOriginal, ConflictError } from "@/lib/storage";
import type { Draft } from "@/lib/types";
import { listBrains, createBrain, requireBrain } from "@/lib/brains";
import { brainKey, MAIN_BRAIN_ID } from "@/lib/brain-scope";
import { createKnowledgeJob, listKnowledgeJobs, getKnowledgeJob, stepKnowledgeJob, pauseKnowledgeJob, resumeKnowledgeJob } from "@/lib/knowledge";
import { startNextKnowledgePass, knowledgeActivity, answerKnowledgeQuestion } from "@/lib/knowledge";
import { getSpending } from "@/lib/spend";
import { readPassageImage } from "@/lib/knowledge-images";
import { getQuestionCoverage, saveQuestionProfile } from "@/lib/knowledge-question-profile";
import { knowledgeNodeDetail, searchKnowledgeNodes } from "@/lib/knowledge-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<{ segments: string[] }> };
const scopeSchema = z.array(z.string().max(150)).max(300).default([]);
const questionSchema = z.string().trim().min(3).max(3000);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function body(request: Request, allowEmpty = false) {
  if (Number(request.headers.get("content-length") ?? 0) > 150_000) throw new HttpError(413, "This request is too large.");
  return parseJsonRequest(request, allowEmpty);
}
async function handle(request: Request, context: Context) {
  try {
    const route = (await context.params).segments.join("/");
    if (request.method !== "GET") checkOrigin(request);
    if (route === "auth/login" && request.method === "POST") {
      const input = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(256) }).parse(await body(request));
      return json(await login(request, input.username, input.password));
    }
    const user = await requireUser();
    if (route === "auth/logout" && request.method === "POST") { const session = await getSession(); session.destroy(); return json({ ok: true }); }
    if (route === "brains" && request.method === "GET") return json(await listBrains());
    if (route === "brains" && request.method === "POST") {
      await requireUser(true);
      const input = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(240).default("") }).parse(await body(request));
      return json(await createBrain(input.name, input.description, user.name), 201);
    }
    const brainParams = new URL(request.url).searchParams;
    if (brainParams.getAll("brain").length > 1) throw new HttpError(400, "Choose one active brain per request.");
    const brainId = brainParams.get("brain") ?? MAIN_BRAIN_ID;
    await requireBrain(brainId);
    if (route === "spending" && request.method === "GET") return json(await getSpending(brainId));
    if (route === "source-image" && request.method === "GET") {
      const passage = (await getCorpus(brainId)).passages.find(passage => passage.id === brainParams.get("passage"));
      if (!passage?.image) throw new HttpError(404, "This page image is not in the selected brain.");
      const bytes = await readPassageImage(passage);
      return new Response(new Blob([bytes as BlobPart], { type: "image/jpeg" }).stream(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    }
    if (route === "knowledge/nodes" && request.method === "GET") {
      const input = z.object({ q: z.string().max(300).default(""), offset: z.coerce.number().int().min(0).max(1_000_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(Object.fromEntries(brainParams));
      return json(searchKnowledgeNodes(await getCorpus(brainId), input.q, input.offset, input.limit));
    }
    if (route === "knowledge/node" && request.method === "GET") {
      const id = z.string().min(1).max(200).parse(brainParams.get("id"));
      const detail = knowledgeNodeDetail(await getCorpus(brainId), id);
      if (!detail) throw new HttpError(404, "This knowledge node is not in the selected brain.");
      return json(detail);
    }
    if (route === "knowledge/coverage" && request.method === "GET") {
      const input = z.object({ q: z.string().max(300).default(""), offset: z.coerce.number().int().min(0).max(1_000_000).default(0), limit: z.coerce.number().int().min(1).max(25).default(20) }).parse(Object.fromEntries(brainParams));
      return json(await getQuestionCoverage(brainId, { query: input.q, offset: input.offset, limit: input.limit }));
    }
    if (route === "knowledge/jobs" && request.method === "GET") {
      const [jobs, coverage] = await Promise.all([listKnowledgeJobs(brainId), getQuestionCoverage(brainId, { summaryOnly: true })]);
      return json({ jobs: jobs.map(job => coverage.jobId === job.id ? { ...job, coverage: coverage.entries.map(entry => ({ question: entry.text, status: entry.status, nodeIds: entry.nodeIds })) } : job) });
    }
    if (route === "knowledge/jobs" && request.method === "POST") {
      await requireUser(true);
      const input = z.object({ sourceIds: z.array(z.string().min(1).max(150)).min(1).max(30), requirements: z.string().max(60_000).default(""), budgetUsd: z.number().min(0.05).max(10).default(3) }).parse(await body(request));
      const job = await createKnowledgeJob(input, brainId, user.name);
      await saveQuestionProfile(input.requirements, job.id, brainId);
      return json(job, 201);
    }
    const knowledgeAction = route.match(/^knowledge\/jobs\/([0-9a-f-]{36})(?:\/(step|pause|resume|next-pass|activity|answer))?$/i);
    if (knowledgeAction) {
      const id = z.string().uuid().parse(knowledgeAction[1]);
      if (!knowledgeAction[2] && request.method === "GET") return json(await getKnowledgeJob(id, brainId));
      if (knowledgeAction[2] === "activity" && request.method === "GET") return json(await knowledgeActivity(id, brainId));
      if (request.method === "POST") {
        await requireUser(true);
        if (knowledgeAction[2] === "next-pass") return json(await startNextKnowledgePass(id, brainId));
        if (knowledgeAction[2] === "answer") {
          const input = z.object({ questionId: z.string().min(1).max(100), answer: z.enum(["include", "exclude"]), note: z.string().max(2000).optional() }).parse(await body(request));
          return json(await answerKnowledgeQuestion(id, brainId, input));
        }
        if (knowledgeAction[2] === "step") return json(await stepKnowledgeJob(id, brainId));
        if (knowledgeAction[2] === "pause") return json(await pauseKnowledgeJob(id, brainId));
        if (knowledgeAction[2] === "resume") {
          const input = z.object({ budgetUsd: z.number().min(0.05).max(10).optional() }).parse(await body(request, true));
          return json(await resumeKnowledgeJob(id, brainId, input));
        }
      }
    }
    if (route === "workspace" && request.method === "GET") return json(await workspace(user, brainId));
    if (route === "source" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id"), corpus = await getCorpus(brainId);
      const source = corpus.sources.find(s => s.id === id); if (!source) throw new HttpError(404, "Source not found."); return json(source);
    }
    if (route === "original" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id"), corpus = await getCorpus(brainId);
      const source = corpus.sources.find(s => s.id === id);
      if (!source || !source.originalAvailable) throw new HttpError(404, "Original bytes are not available for this recovered source. Its extracted text is available in the library.");
      const original = await readOriginal(source.id, source.format, brainId);
      if (!original) throw new HttpError(404, "Original file not found.");
      return new Response(original as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.filename)}` } });
    }
    if (route === "passage" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id"), corpus = await getCorpus(brainId);
      const passage = corpus.passages.find(s => s.id === id); if (!passage) throw new HttpError(404, "Passage not found."); return json({ ...passage, terms: undefined });
    }
    if (route === "ask" && request.method === "POST") {
      const input = z.object({ question: questionSchema, sourceIds: scopeSchema }).parse(await body(request));
      return json(await ask(input.question, input.sourceIds, brainId));
    }
    if (route === "drafts" && request.method === "POST") {
      const input = z.object({ brief: questionSchema, title: z.string().trim().max(180).optional(), sourceIds: scopeSchema }).parse(await body(request));
      return json(await createDraft(input.brief, input.title, input.sourceIds, user.name, brainId));
    }
    if (route === "drafts" && request.method === "PATCH") {
      const input = z.object({ id: z.string().uuid(), text: z.string().max(80_000), title: z.string().trim().min(1).max(180), status: z.enum(["outline", "draft", "reviewed"]), revision: z.number().int().min(1) }).parse(await body(request));
      const draft = await updateRecord<Draft | null>(brainKey(brainId, `drafts/${input.id}.json`), null, old => {
        if (!old) throw new HttpError(404, "Draft not found.");
        if (old.revision !== input.revision) throw new HttpError(409, "This draft was changed by someone else. Reload the workspace before saving.");
        return { ...old, title: input.title, text: input.text, status: input.status, revision: old.revision + 1, updatedAt: new Date().toISOString() };
      }); return json(draft);
    }
    if (route === "workflows" && request.method === "POST") {
      const input = z.object({ kind: z.enum(["research-brief", "article-plan", "connection-map", "knowledge-audit"]), question: z.string().trim().max(3000).default(""), sourceIds: scopeSchema }).parse(await body(request));
      if (input.kind !== "knowledge-audit" && input.question.length < 3) throw new HttpError(400, "Add a topic or question for this workflow.");
      return json(await runWorkflow(input.kind, input.question, input.sourceIds, user.name, brainId));
    }
    if (route === "settings" && request.method === "POST") {
      await requireUser(true);
      const input = z.object({ provider: z.enum(["deepseek", "openrouter"]).optional(), model: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.:/-]+$/), apiKey: z.string().trim().max(500).regex(/^\S*$/, "Paste only the API key, without spaces, line breaks, or angle brackets.").refine(key => !/[<>]/.test(key), "Paste only the API key, without angle brackets.").optional(), writingInstructions: z.string().max(6000) }).parse(await body(request));
      return json(await saveSettings(input));
    }
    if (route === "import" && request.method === "POST") {
      await requireUser(true);
      if (Number(request.headers.get("content-length") ?? 0) > 4_100_000) throw new HttpError(413, "Choose a file under 4 MB.");
      const data = await request.formData(), file = data.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Choose a file to import.");
      return json(await importFile(file, brainId));
    }
    throw new HttpError(404, "That workspace action was not found.");
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || "Check the request fields." }, 400);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof ConflictError) return json({ error: error.message }, 409);
    if (error instanceof SyntaxError) return json({ error: "The request contained invalid JSON." }, 400);
    console.error("Workspace operation failed:", error instanceof Error ? error.name + ": " + error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]") : "Unknown error");
    return json({ error: "The workspace could not complete this action. Check the private storage connection and try again." }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
