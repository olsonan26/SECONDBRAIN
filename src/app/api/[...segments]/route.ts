import { z } from "zod";
import { getSession, requireUser, checkOrigin, HttpError, login } from "@/lib/auth";
import { workspace, ask, createDraft, runWorkflow } from "@/lib/workspace";
import { getCorpus } from "@/lib/corpus";
import { saveSettings } from "@/lib/model";
import { importFile } from "@/lib/import";
import { updateRecord, readOriginal } from "@/lib/storage";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<{ segments: string[] }> };
const scopeSchema = z.array(z.string().max(150)).max(300).default([]);
const questionSchema = z.string().trim().min(3).max(3000);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function body(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 150_000) throw new HttpError(413, "This request is too large.");
  return request.json();
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
    if (route === "workspace" && request.method === "GET") return json(await workspace(user));
    if (route === "source" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id"), corpus = await getCorpus();
      const source = corpus.sources.find(s => s.id === id); if (!source) throw new HttpError(404, "Source not found."); return json(source);
    }
    if (route === "original" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id"), corpus = await getCorpus();
      const source = corpus.sources.find(s => s.id === id);
      if (!source || !source.originalAvailable) throw new HttpError(404, "Original bytes are not available for this recovered source. Its extracted text is available in the library.");
      const original = await readOriginal(source.id, source.format);
      if (!original) throw new HttpError(404, "Original file not found.");
      return new Response(original as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.filename)}` } });
    }
    if (route === "passage" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id"), corpus = await getCorpus();
      const passage = corpus.passages.find(s => s.id === id); if (!passage) throw new HttpError(404, "Passage not found."); return json({ ...passage, terms: undefined });
    }
    if (route === "ask" && request.method === "POST") {
      const input = z.object({ question: questionSchema, sourceIds: scopeSchema }).parse(await body(request));
      return json(await ask(input.question, input.sourceIds));
    }
    if (route === "drafts" && request.method === "POST") {
      const input = z.object({ brief: questionSchema, title: z.string().trim().max(180).optional(), sourceIds: scopeSchema }).parse(await body(request));
      return json(await createDraft(input.brief, input.title, input.sourceIds, user.name));
    }
    if (route === "drafts" && request.method === "PATCH") {
      const input = z.object({ id: z.string().uuid(), text: z.string().max(80_000), title: z.string().trim().min(1).max(180), status: z.enum(["outline", "draft", "reviewed"]), revision: z.number().int().min(1) }).parse(await body(request));
      const draft = await updateRecord<Draft | null>(`drafts/${input.id}.json`, null, old => {
        if (!old) throw new HttpError(404, "Draft not found.");
        if (old.revision !== input.revision) throw new HttpError(409, "This draft was changed by someone else. Reload the workspace before saving.");
        return { ...old, title: input.title, text: input.text, status: input.status, revision: old.revision + 1, updatedAt: new Date().toISOString() };
      }); return json(draft);
    }
    if (route === "workflows" && request.method === "POST") {
      const input = z.object({ kind: z.enum(["research-brief", "article-plan", "connection-map", "knowledge-audit"]), question: z.string().trim().max(3000).default(""), sourceIds: scopeSchema }).parse(await body(request));
      if (input.kind !== "knowledge-audit" && input.question.length < 3) throw new HttpError(400, "Add a topic or question for this workflow.");
      return json(await runWorkflow(input.kind, input.question, input.sourceIds, user.name));
    }
    if (route === "settings" && request.method === "POST") {
      await requireUser(true);
      const input = z.object({ model: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.:/-]+$/), apiKey: z.string().max(500).optional(), writingInstructions: z.string().max(6000) }).parse(await body(request));
      return json(await saveSettings(input));
    }
    if (route === "import" && request.method === "POST") {
      await requireUser(true);
      if (Number(request.headers.get("content-length") ?? 0) > 4_100_000) throw new HttpError(413, "Choose a file under 4 MB.");
      const data = await request.formData(), file = data.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Choose a file to import.");
      return json(await importFile(file));
    }
    throw new HttpError(404, "That workspace action was not found.");
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || "Check the request fields." }, 400);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: "The request contained invalid JSON." }, 400);
    console.error("Workspace operation failed:", error instanceof Error ? error.name + ": " + error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]") : "Unknown error");
    return json({ error: "The workspace could not complete this action. Check the private storage connection and try again." }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
