import "server-only";
import { assertExtractionRecoverySafe } from "./recovery-state";
import { createHash, randomUUID } from "node:crypto";
import type { Corpus, KnowledgeJobSummary, KnowledgeStage, Passage, Settings } from "./types";
import { HttpError } from "./auth";
import { brainKey } from "./brain-scope";
import { requireBrain } from "./brains";
import { getCorpus, invalidateCorpus } from "./corpus";
import { getSettings } from "./model";
import { modelConnection, modelError } from "./model-provider";
import { listRecords, readRecord, updateRecord, writeRecord } from "./storage";
import { applicationInstructions, extractionShape, finalVerificationInstructions, independentlyVerifiedFragment, knowledgeInstructions, reviewShape, type Extraction, type KnowledgeReview, type PassageAudit } from "./knowledge-schema";
import { granularityInstructions as teachingGranularityInstructions, processingNoteInstructions, validatedEvidence } from "./knowledge-schema";
import { reusableKnowledgeInstructions, usefulnessVerificationInstructions, substantiveKnowledgeInstructions, operatorAuditInstructions } from "./knowledge-usefulness";
import { imageMessages, imageContextCeiling } from "./knowledge-images";
import { mergeRepeatedTeachings, mergeGraphEdges } from "./knowledge-dedup";
import { parseKnowledgeResponse, responseFormatInstructions, type ValidationHold } from "./knowledge-response";
import { knowledgeNavigation } from "./knowledge-context";

const granularityInstructions = `${teachingGranularityInstructions}\n${processingNoteInstructions}\n${substantiveKnowledgeInstructions}\n${responseFormatInstructions}\n${operatorAuditInstructions}`;

const LEASE_MS = 150_000;
const MAX_COMPLETION_TOKENS = 12_000;
const MAX_ATTEMPTS = 3;
const MAX_WORKERS = 3;
const INPUT_RATE = 0.35 / 1_000_000;
const OUTPUT_RATE = 1.4 / 1_000_000;
const BATCH_SIZE = 2;
type Phase = "extract" | "review" | "verify";
type Batch = {
  id: string; passageIds: string[]; phase: Phase; state: "pending" | "leased" | "done" | "failed";
  attempts: number; revision: number; lease?: { token: string; expiresAt: number; reservation: number };
  candidate?: Extraction; review?: KnowledgeReview; error?: string; validationHolds?: ValidationHold[];
};
export interface KnowledgeJob {
  imagePassageIds?: string[];
  qualityAuditLock?: string;
  qualityAuditsApplied?: string[];
  scanPass?: number;
  passHistory?: { pass: number; finishedAt: string; nodesAdded: number; costUsd: number; audits: PassageAudit[] }[];
  activity?: { at: string; pass: number; phase: string; message: string; passageIds: string[] }[];
  questions?: { id: string; pass: number; passageId: string; quote: string; question: string; reason: string; answer?: "include" | "exclude"; note?: string; answeredAt?: string }[];
  version: 1; id: string; brainId: string; sourceIds: string[]; author: string;
  createdAt: string; updatedAt: string; stage: KnowledgeStage; provider: Settings["provider"]; model: string;
  requirements: string; budgetUsd: number; costUsd: number; measuredCostUsd: number; estimatedCostUsd: number; estimatedTotalCostUsd: number;
  inputTokens: number; outputTokens: number; nodesAdded: number; edgesAdded: number;
  accountedCalls: string[];
  passages: PassageAudit[]; passageHashes: Record<string, string>; batches: Batch[];
  warnings: string[]; error?: string;
}
type SourceRegistry = { sources: Record<string, string>; creating: Record<string, KnowledgeJob> };

const round = (value: number) => Math.round(value * 1e8) / 1e8;
const stamp = () => new Date().toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const knowledgePassageHash = (passage: Passage) => hash(passage.text + (passage.image ? `\nOriginal image SHA256:${passage.image.sha256}` : ""));
function makeBatches(passages: Passage[], prefix = ""): Batch[] {
  const batches: Batch[] = [];
  for (let offset = 0; offset < passages.length;) {
    const count = passages[offset].sourceId === passages[offset + 1]?.sourceId ? BATCH_SIZE : 1;
    batches.push({ id: `${prefix}${batches.length}`, passageIds: passages.slice(offset, offset + count).map(passage => passage.id), phase: "extract", state: "pending", attempts: 0, revision: 0 });
    offset += count;
  }
  return batches;
}
function pairUntouchedPhotos(job: KnowledgeJob) {
  const photos = new Set(job.imagePassageIds ?? []);
  const order = new Map(job.passages.map((passage, index) => [passage.passageId, { ...passage, index }]));
  const untouched = (batch: Batch) => {
    const audit = order.get(batch.passageIds[0]);
    // Legacy retry counters can have been reset by a prior Resume. A pristine
    // coverage audit is also required before changing the batch identity.
    return batch.state === "pending" && batch.phase === "extract" && batch.attempts === 0 && batch.revision === 0 && !batch.lease && !batch.candidate && !batch.review && batch.passageIds.length === 1 && photos.has(batch.passageIds[0]) && audit?.disposition === "pending" && !audit.nodeIds.length && ["Not yet independently reviewed.", "Awaiting the next full-book coverage pass."].includes(audit.reason);
  };
  const paired: Batch[] = [];
  for (let index = 0; index < job.batches.length; index++) {
    const first = job.batches[index], next = job.batches[index + 1];
    const a = order.get(first.passageIds[0]), b = next && order.get(next.passageIds[0]);
    if (next && untouched(first) && untouched(next) && a && b && a.sourceId === b.sourceId && b.index === a.index + 1) {
      paired.push({ id: `pair-${first.id}-${next.id}`, passageIds: [...first.passageIds, ...next.passageIds], phase: "extract", state: "pending", attempts: 0, revision: 0 });
      index++;
    } else paired.push(first);
  }
  job.batches = paired;
}
function jobKey(brainId: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, "Invalid knowledge extraction job ID.");
  return brainKey(brainId, `knowledge/jobs/${id}.json`);
}
function summary(job: KnowledgeJob): KnowledgeJobSummary {
  const processed = job.passages.filter(p => p.disposition !== "pending");
  return { scanPass: job.scanPass ?? 1, completedPasses: [...(job.passHistory ?? []).map(pass => pass.pass), ...(["complete", "needs-review"].includes(job.stage) ? [job.scanPass ?? 1] : [])], openQuestions: (job.questions ?? []).filter(question => !question.answer).length, id: job.id, sourceIds: job.sourceIds, author: job.author, createdAt: job.createdAt, updatedAt: job.updatedAt,
    stage: job.stage, provider: job.provider, model: job.model, totalPassages: job.passages.length,
    processedPassages: processed.length, pendingCount: job.passages.length - processed.length,
    reviewedPassages: job.batches.filter(b => b.state === "done").reduce((n, b) => n + b.passageIds.length, 0),
    extractedPassages: job.batches.filter(b => b.phase !== "extract" || b.state === "done").reduce((n, b) => n + b.passageIds.length, 0),
    excludedPassages: processed.filter(p => p.disposition.startsWith("excluded")).length,
    unresolvedPassages: processed.filter(p => p.disposition === "unresolved").length,
    nodesAdded: job.nodesAdded, edgesAdded: job.edgesAdded, costUsd: job.costUsd,
    measuredCostUsd: job.measuredCostUsd, estimatedCostUsd: job.estimatedCostUsd, estimatedTotalCostUsd: job.estimatedTotalCostUsd, budgetUsd: job.budgetUsd,
    reservedUsd: round(job.batches.reduce((total, b) => total + (b.lease?.reservation ?? 0), 0)),
    inputTokens: job.inputTokens, outputTokens: job.outputTokens,
    requirementsCount: job.requirements.split(/\r?\n/).filter(line => line.trim()).length,
    currentPhase: (job.batches.find(b => b.state === "leased")?.phase ?? job.batches.find(b => b.state === "pending")?.phase) === "extract" ? "extract" : "review",
    error: job.error, warnings: job.warnings, imagePassages: job.imagePassageIds?.length ?? 0, reviewedImages: job.passages.filter(passage => job.imagePassageIds?.includes(passage.passageId) && passage.disposition !== "pending").length };
}
async function readJob(id: string, brainId: string) {
  let job = (await readRecord<KnowledgeJob>(jobKey(brainId, id)))?.value;
  if (!job) {
    const snapshot = (await readRecord<SourceRegistry>(brainKey(brainId, "knowledge/source-claims.json")))?.value.creating[id];
    if (snapshot?.brainId === brainId) job = await updateRecord(jobKey(brainId, id), snapshot, old => old);
  }
  if (!job || job.brainId !== brainId) throw new HttpError(404, "This knowledge extraction job is not in the selected brain.");
  return job;
}
async function recoverCreatingJobs(brainId: string) {
  const key = brainKey(brainId, "knowledge/source-claims.json");
  const registry = (await readRecord<SourceRegistry>(key))?.value;
  if (!registry || !Object.keys(registry.creating).length) return;
  const recovered: string[] = [];
  for (const snapshot of Object.values(registry.creating)) if (snapshot.brainId === brainId) {
    await updateRecord(jobKey(brainId, snapshot.id), snapshot, old => old); recovered.push(snapshot.id);
  }
  await updateRecord(key, registry, current => { for (const id of recovered) delete current.creating[id]; return current; });
}
function addWarning(job: KnowledgeJob, message: string) { job.warnings = [...new Set([...job.warnings, message])].slice(-70); }
function logActivity(job: KnowledgeJob, phase: string, message: string, passageIds: string[] = []) {
  job.activity = [...(job.activity ?? []), { at: stamp(), pass: job.scanPass ?? 1, phase, message, passageIds }].slice(-300);
}

export async function knowledgeActivity(id: string, brainId: string) {
  const job = await readJob(id, brainId);
  return { events: (job.activity ?? []).slice(-100).reverse(), questions: [...(job.questions ?? [])].sort((a, b) => Number(Boolean(a.answer)) - Number(Boolean(b.answer))).slice(0, 100), audits: job.passages.filter(passage => passage.disposition !== "pending").slice(-100), passHistory: (job.passHistory ?? []).map(({ audits, ...pass }) => ({ ...pass, reviewed: audits.length, unresolved: audits.filter(audit => audit.disposition === "unresolved").length })) };
}

export async function answerKnowledgeQuestion(id: string, brainId: string, input: { questionId: string; answer: "include" | "exclude"; note?: string }) {
  const initial = await readJob(id, brainId);
  return summary(await updateRecord(jobKey(brainId, id), initial, job => {
    const question = job.questions?.find(question => question.id === input.questionId);
    if (!question) throw new HttpError(404, "This clarification is not in this brain's extraction job.");
    question.answer = input.answer; question.note = input.note?.slice(0, 2000); question.answeredAt = stamp();
    logActivity(job, "clarification", "Owner saved a usefulness preference. Source evidence remains mandatory; no model call was started.", [question.passageId]);
    job.updatedAt = stamp(); return job;
  }));
}

export async function startNextKnowledgePass(id: string, brainId: string) {
  await assertExtractionRecoverySafe(brainId, id);
  const initial = await readJob(id, brainId), corpus = await getCorpus(brainId);
  return summary(await updateRecord(jobKey(brainId, id), initial, job => {
    if (job.qualityAuditLock) throw new HttpError(409, "An operator quality audit is saving source-checked corrections. Keep the scan paused until it finishes.");
    releaseExpired(job);
    if (!["complete", "needs-review"].includes(job.stage) || job.batches.some(batch => batch.state === "pending" || batch.state === "leased")) throw new HttpError(409, "Finish or resume the current pass before starting another whole-book pass.");
    const pass = job.scanPass ?? 1;
    if (pass >= 3) throw new HttpError(409, "All three full-book passes have already been run. Review unresolved evidence rather than silently starting a fourth paid scan.");
    const passages = corpus.passages.filter(passage => job.sourceIds.includes(passage.sourceId));
    if (passages.length !== job.passages.length || passages.some(passage => knowledgePassageHash(passage) !== job.passageHashes[passage.id])) throw new HttpError(409, "The source changed. This scan cannot silently replace the saved book.");
    job.passHistory = [...(job.passHistory ?? []), { pass, finishedAt: stamp(), nodesAdded: job.nodesAdded, costUsd: job.costUsd, audits: structuredClone(job.passages) }];
    job.scanPass = pass + 1;
    job.batches = makeBatches(passages, `pass${pass + 1}-`);
    job.passages = passages.map(passage => ({ passageId: passage.id, sourceId: passage.sourceId, page: passage.page, disposition: "pending", reason: "Awaiting the next full-book coverage pass.", nodeIds: [] }));
    job.stage = "queued"; job.error = undefined; job.updatedAt = stamp();
    logActivity(job, "scan", `Owner started full-book pass ${pass + 1} of 3. All passages will be reread against existing graph knowledge. The same accumulated spending cap is retained.`);
    return job;
  }));
}
function updateStage(job: KnowledgeJob) {
  if (["paused", "paused-budget", "failed"].includes(job.stage)) return;
  if (job.batches.some(b => b.state === "leased" || b.state === "pending")) job.stage = "running";
  else if (job.batches.some(b => b.state === "failed") || job.passages.some(p => p.disposition === "unresolved")) job.stage = "needs-review";
  else job.stage = "complete";
}
function releaseExpired(job: KnowledgeJob) {
  for (const batch of job.batches) if (batch.lease && batch.lease.expiresAt <= Date.now()) {
    // A terminated request may already have been billed. Never free unknown spend for another call.
    applyAccounting(job, batch.lease.token, { cost: batch.lease.reservation, measuredCost: 0, inputTokens: 0, outputTokens: 0, measured: false });
    addWarning(job, "An interrupted model call had unknown billing. Its full reserved maximum was charged to the safety budget; actual provider spend may be lower.");
    batch.lease = undefined;
    batch.state = batch.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    batch.error = "The previous extraction request was interrupted. Its result was not accepted.";
    job.stage = "paused";
    job.error = "An interrupted request has uncertain billing. Progress and the conservative spending estimate are saved. No automatic paid retry will start; review spending before explicitly resuming.";
  }
}
export const MAX_KNOWLEDGE_BUDGET_USD = 10;
function validateBudget(value: number) { if (!Number.isFinite(value) || value < 0.01 || value > MAX_KNOWLEDGE_BUDGET_USD) throw new HttpError(400, "Choose an extraction spending cap between $0.01 and $10. A higher limit has not been authorized."); }

export async function listKnowledgeJobs(brainId: string) {
  await requireBrain(brainId);
  await recoverCreatingJobs(brainId);
  const jobs = await listRecords<KnowledgeJob>(brainKey(brainId, "knowledge/jobs"));
  return jobs.filter(j => j.brainId === brainId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summary);
}
export async function getKnowledgeJob(id: string, brainId: string) {
  const job = await readJob(id, brainId);
  return { ...summary(job), requirements: job.requirements, passageAudit: job.passages,
    batches: job.batches.map(({ id, passageIds, phase, state, attempts, error }) => ({ id, passageIds, phase, state, attempts, error })) };
}
export async function createKnowledgeJob(input: { sourceIds: string[]; requirements?: string; budgetUsd?: number }, brainId: string, author: string) {
  const freshAuthorization = await assertExtractionRecoverySafe(brainId);
  await requireBrain(brainId);
  const budgetUsd = input.budgetUsd ?? 3; validateBudget(budgetUsd);
  if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 20 || input.sourceIds.some(id => typeof id !== "string")) throw new HttpError(400, "Choose one or more source documents in this brain.");
  const requirements = input.requirements?.trim() ?? "";
  if (requirements.length > 60_000) throw new HttpError(400, "The coverage wish list is limited to 60,000 characters.");
  const corpus = await getCorpus(brainId), settings = await getSettings();
  if (!settings.apiKey) throw new HttpError(422, "Connect the model in Settings before starting AI knowledge extraction.");
  if (settings.provider !== "openrouter") throw new HttpError(422, "Budget-capped extraction currently requires your OpenRouter connection. Select OpenRouter in Settings.");
  const sourceIds = [...new Set(input.sourceIds)];
  if (freshAuthorization && (budgetUsd > freshAuthorization.budgetUsd || sourceIds.length !== 1 || sourceIds[0] !== freshAuthorization.sourceId || corpus.sources.find(source => source.id === sourceIds[0])?.sha256 !== freshAuthorization.sourceSha256)) throw new HttpError(409, "This fresh authorization covers only the original page photographs and its separately approved spending cap.");
  if (sourceIds.some(id => !corpus.sources.some(s => s.id === id))) throw new HttpError(404, "A selected source is not in this brain.");
  const passages = corpus.passages.filter(p => sourceIds.includes(p.sourceId));
  if (!passages.length) throw new HttpError(422, "The selected sources have no searchable text passages.");
  const existing = await listKnowledgeJobs(brainId);
  if (freshAuthorization && existing.some(job => job.id === freshAuthorization.jobId)) throw new HttpError(409, "The authorized fresh scan already exists. Resume its saved job; creating another job cannot reset the approved total budget.");
  if (existing.some(j => j.stage !== "complete" && j.sourceIds.some(id => sourceIds.includes(id)))) throw new HttpError(409, "An extraction job already exists for this source. Resume that job to keep its progress and spending cap.");
  const id = freshAuthorization?.jobId ?? randomUUID(), now = stamp();
  const batches = makeBatches(passages);
  const inputEstimate = passages.reduce((n, p) => n + p.text.length, 0) / 3;
  const estimatedTotalCostUsd = round(inputEstimate * INPUT_RATE * 4 + batches.length * MAX_COMPLETION_TOKENS * OUTPUT_RATE * 3);
  const job: KnowledgeJob = { version: 1, id, brainId, sourceIds, author, createdAt: now, updatedAt: now, stage: "queued", provider: settings.provider, model: settings.model,
    imagePassageIds: passages.filter(passage => passage.image).map(passage => passage.id),
    requirements, budgetUsd, costUsd: 0, measuredCostUsd: 0, estimatedCostUsd: 0, estimatedTotalCostUsd, inputTokens: 0, outputTokens: 0, nodesAdded: 0, edgesAdded: 0, accountedCalls: [],
    passages: passages.map(p => ({ passageId: p.id, sourceId: p.sourceId, page: p.page, disposition: "pending", reason: "Not yet independently reviewed.", nodeIds: [] })),
    passageHashes: Object.fromEntries(passages.map(p => [p.id, knowledgePassageHash(p)])), batches,
    warnings: [passages.some(p => p.image) ? "Original page images are attached to every extraction, omission-review and verification call. OCR is an unverified search aid. Unreadable visual details remain unresolved, never guessed." : "Text-only extraction cannot read unextracted chart drawings or image-only tables. Such passages remain unresolved until the visual material is supplied.", "Processing every passage and performing omission reviews does not guarantee that AI found every possible teaching. Exact evidence and a coverage audit are retained.", "Spending includes measured provider cost when returned, otherwise conservative token-based or full-call reservation accounting. The cap is checked before every model call."] };
  // All selected sources are claimed in one compare-and-swap. Two tabs cannot
  // create independent spending caps for the same book at the same time.
  const complete = new Set(existing.filter(j => j.stage === "complete").map(j => j.id));
  const registryKey = brainKey(brainId, "knowledge/source-claims.json");
  const registry = await updateRecord<SourceRegistry>(registryKey, { sources: {}, creating: {} }, current => {
    if (sourceIds.some(sourceId => current.sources[sourceId] && !complete.has(current.sources[sourceId]))) throw new HttpError(409, "An extraction job already exists for this source. Resume it to preserve its progress and spending cap.");
    for (const sourceId of sourceIds) current.sources[sourceId] = id;
    current.creating[id] = job;
    return current;
  });
  await updateRecord(jobKey(brainId, id), job, old => old);
  // Keep the recovery snapshot if clearing it fails; list/get can repair an
  // interrupted creation without generating another job or another budget.
  await updateRecord(registryKey, registry, current => { delete current.creating[id]; return current; }).catch(() => {});
  return summary(job);
}

export async function pauseKnowledgeJob(id: string, brainId: string) {
  const initial = await readJob(id, brainId);
  return summary(await updateRecord(jobKey(brainId, id), initial, job => { if (!["complete", "needs-review"].includes(job.stage)) job.stage = "paused"; logActivity(job, "checkpoint", "Pause and save requested. No new model calls will start. An already-running call may finish and save its result and cost."); job.updatedAt = stamp(); return job; }));
}
export async function resumeKnowledgeJob(id: string, brainId: string, input: { budgetUsd?: number } = {}) {
  const freshAuthorization = await assertExtractionRecoverySafe(brainId, id);
  if (freshAuthorization && input.budgetUsd !== undefined && input.budgetUsd > freshAuthorization.budgetUsd) throw new HttpError(409, "This fresh scan cannot exceed its separately authorized total cap.");
  if (input.budgetUsd !== undefined) validateBudget(input.budgetUsd);
  const initial = await readJob(id, brainId);
  return summary(await updateRecord(jobKey(brainId, id), initial, job => {
    if (job.qualityAuditLock) throw new HttpError(409, "An operator quality audit is saving source-checked corrections. Keep the scan paused until it finishes.");
    releaseExpired(job);
    // Pair only never-started legacy image work. Saved candidates, reviews,
    // failed/charged attempts, receipts and completed pages keep their IDs.
    pairUntouchedPhotos(job);
    // Older saved jobs may still have larger batches. Shrink only untouched
    // extraction work; never discard a completed review or an active lease.
    job.batches = job.batches.flatMap(batch => {
      if (batch.phase !== "extract" || batch.state !== "pending" || batch.passageIds.length <= BATCH_SIZE) return [batch];
      const pieces: Batch[] = [];
      for (let start = 0; start < batch.passageIds.length; start += BATCH_SIZE) pieces.push({ id: `${batch.id}.chunk${start / BATCH_SIZE}`, passageIds: batch.passageIds.slice(start, start + BATCH_SIZE), phase: "extract", state: "pending", attempts: 0, revision: batch.revision + 1 });
      return pieces;
    });
    if (input.budgetUsd !== undefined) {
      if (input.budgetUsd < job.costUsd + job.batches.reduce((n, b) => n + (b.lease?.reservation ?? 0), 0)) throw new HttpError(400, "The cap cannot be lower than already spent and reserved usage.");
      job.budgetUsd = input.budgetUsd;
    }
    for (const batch of job.batches) if (batch.state === "failed") {
      batch.state = "pending"; batch.attempts = 0; batch.error = undefined;
      for (const audit of job.passages) if (batch.passageIds.includes(audit.passageId)) { audit.disposition = "pending"; audit.reason = "Resuming a previously failed bounded request."; }
    }
    const firstPassStillPending = job.batches.some(batch => batch.state === "pending" || batch.state === "leased");
    for (const batch of job.batches) if (!firstPassStillPending && batch.state === "done" && batch.passageIds.some(p => job.passages.some(a => a.passageId === p && a.disposition === "unresolved"))) {
      batch.state = "pending"; batch.phase = "extract"; batch.attempts = 0; batch.revision += 1; batch.candidate = undefined; batch.review = undefined; batch.validationHolds = undefined;
      for (const audit of job.passages) if (batch.passageIds.includes(audit.passageId) && audit.disposition === "unresolved") { audit.disposition = "pending"; audit.reason = "Requeued for explicit follow-up review."; }
    }
    job.stage = "running"; job.error = undefined; job.updatedAt = stamp(); logActivity(job, "checkpoint", "Owner resumed the saved pass with all previous knowledge, reviewed passages and spending retained."); updateStage(job); return job;
  }));
}

function promptFor(job: KnowledgeJob, batch: Batch, passages: Passage[], corpus: Corpus) {
  const contextIds = new Set(batch.passageIds);
  const boundary: Passage[] = [];
  for (const passage of passages) {
    const index = corpus.passages.findIndex(p => p.id === passage.id);
    for (const neighbour of [corpus.passages[index - 1], corpus.passages[index + 1]]) if (neighbour && neighbour.sourceId === passage.sourceId && !contextIds.has(neighbour.id) && !boundary.some(p => p.id === neighbour.id)) boundary.push(neighbour);
  }
  // Full wish list is preserved privately. Prompt only likely relevant lines; it is never source authority.
  const vocabulary = new Set(passages.flatMap(p => p.text.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? []));
  const lines = job.requirements.split(/\r?\n/).map(text => ({ text, score: (text.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? []).reduce((n, term) => n + Number(vocabulary.has(term)), 0) })).filter(v => v.score > 0).sort((a, b) => b.score - a.score);
  const requirements = lines.slice(0, 24).map(v => v.text).join("\n").slice(0, 6000);
  const imagePolicy = passages.some(passage => passage.image) ? `\nORIGINAL PAGE IMAGES ARE ATTACHED. Read the text AND diagrams, chart layouts, arrows, wheels, tables, degrees, glyphs and relationships in the actual image during extraction, review AND verification. OCR is an unverified search aid; correct readings must come from the image, not guessed astrology knowledge. MANDATORY for EVERY teaching from an image-backed target, including ordinary visible text: use evidence:{passageId,imageId,visualObservation,quote:""}; imageId must match the supplied target's image.id and visualObservation must precisely describe the visible labels/geometry supporting that specific claim. These observations are NOT verbatim quotations. Every such evidence item MUST have imageId AND a precise visualObservation, even for printed prose. An OCR quote alone is invalid. Optional quote may be empty; do not repeat faulty OCR as evidence. Relationship labels must be short (at most 140 characters), not entire explanatory paragraphs. If OCR says 1800 while the image says 180 degrees, cite an image observation, not the wrong OCR. Mark genuinely unreadable symbols or uncertain chart connections unresolved. Never claim an attached image is absent. Do not list unrelated wish-list topics as missing just because this page does not address them. Prioritize every distinct reusable teaching, preserve conditions, and do not duplicate an existing claim merely by rephrasing it.` : "";
  return [
    { role: "system", content: `${knowledgeInstructions}\n${reusableKnowledgeInstructions}\n${applicationInstructions}\n${granularityInstructions}\nFull-book pass ${job.scanPass ?? 1} of 3. ${job.scanPass && job.scanPass > 1 ? "Reread EVERY supplied target passage looking for omissions, distinctions and exceptions missed in the existing graph. Existing graph summaries are navigation data, never evidence. Return additional source-backed atomic knowledge, not paraphrased duplicates." : "Perform initial discovery of every distinct teaching."}\nOnly when genuinely unable to decide whether a specific passage teaches reusable knowledge rather than unrelated storytelling, optionally return clarifications:[{passageId,quote,question,reason}]. Ask a concise usefulness question with the exact quote and concrete ambiguity. Default clarifications to []: do not ask about routine teachings, request permission repeatedly, or ask the user to invent facts. Owner preferences never override source evidence.\n${batch.phase === "extract" ? extractionShape : batch.phase === "review" ? reviewShape : finalVerificationInstructions}${imagePolicy}\n${batch.phase === "verify" ? usefulnessVerificationInstructions : ""}` },
    { role: "user", content: JSON.stringify({ sourcePolicy: "Extract all teachings whether or not a wish-list question mentions them. Boundary context may clarify meaning but cite ONLY the supplied target passages, which are the ones audited in this batch.", coverageWishListNotEvidence: requirements,
      targetPassages: passages.map(p => ({ id: p.id, sourceId: p.sourceId, page: p.page, section: p.section, text: p.text, ...(p.image ? { image: { id: p.image.id, sha256: p.image.sha256, filename: p.image.filename, ocrVerified: p.image.ocrVerified ?? false } } : {}) })),
      boundaryContextNotTarget: boundary.map(p => ({ page: p.page, text: p.text.slice(0, 2200) })),
      ...(batch.error ? { previousValidationFailureNotEvidence: batch.error } : {}),
      duplicateCheckInstructions: "Final verifier: compare every proposed claim with the other proposed claims and existing graph nodes. For a strictly identical atomic claim with all the same conditions and exceptions, include duplicateOf (the earlier proposed key or existing node id) on its teaching check. This authorizes merging provenance, not new facts. Never merge merely related, overlapping, opposite, or differently conditioned claims. Mark bundled multi-teaching proposals unsupported and the passage incomplete; each distinct rule must be independently retrievable. Do not complete cut-off sentences from general knowledge.",
      existingGraphNavigationNotEvidence: knowledgeNavigation(corpus, passages, batch.phase),
      ownerUsefulnessPreferencesNotEvidence: (job.questions ?? []).filter(question => question.answer && contextIds.has(question.passageId)).map(question => ({ passageId: question.passageId, preference: question.answer, note: question.note })),
      ...(batch.phase === "review" ? { candidate: batch.candidate } : batch.phase === "verify" ? { proposedTeachings: [...(batch.candidate?.teachings ?? []), ...(batch.review?.additions ?? [])], proposedRelationships: batch.review?.relationships ?? [], proposedPassages: batch.review?.passages ?? [] } : {}) }) },
  ];
}
function reserveFor(messages: { role: string; content: string }[], imageInputCeiling = 0) {
  // UTF-8 bytes bound input token count more conservatively than character/4 guesses.
  const promptUpperTokens = Math.max(Buffer.byteLength(JSON.stringify(messages), "utf8") + 1000, imageInputCeiling);
  return round((promptUpperTokens * INPUT_RATE + MAX_COMPLETION_TOKENS * OUTPUT_RATE) * 1.05);
}
type Usage = { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
function accountedUsage(usage: Usage | undefined, reservation: number) {
  const validInput = typeof usage?.prompt_tokens === "number" && Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens >= 0;
  const validOutput = typeof usage?.completion_tokens === "number" && Number.isFinite(usage.completion_tokens) && usage.completion_tokens >= 0;
  const inputTokens = validInput ? usage!.prompt_tokens! : 0;
  const outputTokens = validOutput ? usage!.completion_tokens! : 0;
  const measured = typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0;
  const cost = measured ? usage!.cost! : validInput && validOutput ? inputTokens * INPUT_RATE + outputTokens * OUTPUT_RATE : reservation;
  return { cost: round(cost), measuredCost: measured ? round(cost) : 0, inputTokens, outputTokens, measured };
}
function applyAccounting(job: KnowledgeJob, token: string, usage: ReturnType<typeof accountedUsage>) {
  if (job.accountedCalls.includes(token)) return;
  job.accountedCalls.push(token);
  job.costUsd = round(job.costUsd + usage.cost); job.measuredCostUsd = round(job.measuredCostUsd + usage.measuredCost);
  if (!usage.measured) job.estimatedCostUsd = round(job.estimatedCostUsd + usage.cost);
  job.inputTokens += usage.inputTokens; job.outputTokens += usage.outputTokens;
}
type Fragment = ReturnType<typeof independentlyVerifiedFragment>;
type Receipt = NonNullable<Corpus["knowledgeCommits"]>[string];
function replayReceipts(job: KnowledgeJob, corpus: Corpus) {
  for (const batch of job.batches) {
    if (batch.state === "done") continue;
    const receipt = corpus.knowledgeCommits?.[`${job.id}-${batch.id}-${batch.revision}`];
    if (!receipt?.audits || !receipt.usage) continue;
    applyAccounting(job, receipt.usage.token, receipt.usage);
    for (const audit of receipt.audits) { const index = job.passages.findIndex(p => p.passageId === audit.passageId); if (index >= 0) job.passages[index] = audit; }
    job.nodesAdded += receipt.nodes; job.edgesAdded += receipt.edges;
    for (const warning of receipt.warnings ?? []) addWarning(job, warning);
    batch.state = "done"; batch.lease = undefined; batch.candidate = undefined; batch.review = undefined; batch.error = undefined;
  }
}

async function appendFragment(brainId: string, job: KnowledgeJob, batch: Batch, fragment: Fragment, usage: ReturnType<typeof accountedUsage> & { token: string }) {
  const receipt = `${job.id}-${batch.id}-${batch.revision}`;
  const initial = await getCorpus(brainId);
  const updated = await updateRecord<Corpus>(brainKey(brainId, "corpus.json"), initial, corpus => {
    if (corpus.knowledgeCommits?.[receipt]) return corpus;
    const currentNodes = new Set(corpus.nodes.map(n => n.id));
    const merged = mergeRepeatedTeachings(corpus.nodes, fragment.nodes, fragment.edges);
    const edges = merged.edges;
    const audits = fragment.audits.map(audit => ({ ...audit, nodeIds: [...new Set(audit.nodeIds.map(id => merged.redirects.get(id) ?? id))] }));
    const sourceNodes = [...new Set(fragment.nodes.flatMap(n => n.sourceIds))].filter(id => !currentNodes.has(`source:${id}`)).flatMap(id => {
      const source = corpus.sources.find(s => s.id === id);
      return source ? [{ id: `source:${id}`, label: source.title, type: "document", layer: source.layer, community: "Your uploads", sourceIds: [id], description: "Source document with independently reviewed teaching nodes.", degree: 0 }] : [];
    });
    const edgeMerge = mergeGraphEdges(corpus.edges, edges);
    const allEdges = edgeMerge.edges, degrees = new Map<string, number>();
    for (const edge of allEdges) { degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1); degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1); }
    return { ...corpus, importedAt: stamp(), nodes: [...merged.nodes, ...sourceNodes].map(n => ({ ...n, degree: degrees.get(n.id) ?? 0 })), edges: allEdges,
      knowledgeCommits: { ...corpus.knowledgeCommits, [receipt]: { nodes: merged.added, edges: edgeMerge.added, audits, warnings: merged.merged ? [...fragment.warnings, `${merged.merged} exact repeated teaching(s) merged with existing nodes; additional source evidence retained.`] : fragment.warnings, usage } } };
  });
  invalidateCorpus(brainId);
  return updated.knowledgeCommits![receipt];
}

export async function stepKnowledgeJob(id: string, brainId: string) {
  const freshAuthorization = await assertExtractionRecoverySafe(brainId, id);
  const initial = await readJob(id, brainId), corpus = (await readRecord<Corpus>(brainKey(brainId, "corpus.json")))?.value ?? await getCorpus(brainId), settings = await getSettings();
  if (freshAuthorization && (initial.budgetUsd > freshAuthorization.budgetUsd || initial.sourceIds.length !== 1 || initial.sourceIds[0] !== freshAuthorization.sourceId)) throw new HttpError(409, "This job does not match the separately authorized fresh scan and total cap.");
  if (!settings.apiKey || settings.provider !== initial.provider || settings.model !== initial.model) throw new HttpError(422, "The model connection changed. Restore this job's provider and model in Settings before resuming; its writing instructions were not changed.");
  const imageCeiling = ["queued", "running"].includes(initial.stage) && initial.batches.some(batch => batch.state === "pending" && batch.passageIds.some(id => corpus.passages.some(passage => passage.id === id && passage.image))) ? await imageContextCeiling(settings.model) : 0;
  const token = randomUUID();
  let claimedId: string | undefined;
  const claimed = await updateRecord(jobKey(brainId, id), initial, job => {
    claimedId = undefined;
    if (job.qualityAuditLock) throw new HttpError(409, "An operator quality audit is saving source-checked corrections. No model call was started.");
    replayReceipts(job, corpus);
    releaseExpired(job);
    if (!["queued", "running"].includes(job.stage)) return job;
    if (job.batches.filter(b => b.state === "leased").length >= MAX_WORKERS) return job;
    const batch = job.batches.find(b => b.state === "pending" && b.phase === "verify") ?? job.batches.find(b => b.state === "pending" && b.phase === "review") ?? job.batches.find(b => b.state === "pending");
    if (!batch) { updateStage(job); return job; }
    const passages = batch.passageIds.map(id => corpus.passages.find(p => p.id === id));
    if (passages.some((p, index) => !p || knowledgePassageHash(p) !== job.passageHashes[batch.passageIds[index]])) throw new HttpError(409, "A source passage or original image fingerprint changed or disappeared. Start a new extraction from the current document.");
    const reservation = reserveFor(promptFor(job, batch, passages as Passage[], corpus), passages.some(passage => passage?.image) ? imageCeiling : 0);
    const outstanding = job.batches.reduce((n, b) => n + (b.lease?.reservation ?? 0), 0);
    if (job.costUsd + outstanding + reservation > job.budgetUsd) { job.stage = "paused-budget"; job.error = "The remaining safety budget cannot reserve another bounded model call. Progress is saved. Raise the cap explicitly to continue."; job.updatedAt = stamp(); return job; }
    batch.lease = { token, expiresAt: Date.now() + LEASE_MS, reservation }; batch.state = "leased"; batch.attempts += 1; claimedId = batch.id;
    job.stage = "running"; job.updatedAt = stamp(); job.error = undefined; logActivity(job, batch.phase, `Checking ${batch.passageIds.length} source passage(s): ${batch.phase === "extract" ? "discovering distinct teachings" : batch.phase === "review" ? "reviewing for omissions and unsupported claims" : "independently checking exact evidence"}.`, batch.passageIds); return job;
  });
  if (!claimedId) return summary(claimed);
  const batch = claimed.batches.find(b => b.id === claimedId)!;
  const passages = batch.passageIds.map(id => corpus.passages.find(p => p.id === id)!);
  const connection = modelConnection(settings);
  let usage: Usage | undefined, resultAccepted = false, failure = "", fatalStatus = 0, truncated = false;
  let extracted: Extraction | undefined;
  let reviewedCandidate: KnowledgeReview | undefined;
  let reviewed: Fragment | undefined;
  let receipt: Receipt | undefined;
  let validationHolds: ValidationHold[] = [];
  let providerRequested = false;
  let preExecutionRejected = false;
  try {
    const messages = await imageMessages(promptFor(claimed, batch, passages, corpus), passages, 2);
    providerRequested = true;
    const response = await fetch(connection.url, { method: "POST", headers: connection.headers, signal: AbortSignal.timeout(85_000),
      body: JSON.stringify({ model: settings.model, temperature: 0, max_tokens: MAX_COMPLETION_TOKENS, ...connection.options,
        provider: { max_price: { prompt: 0.35, completion: 1.4, request: 0 }, sort: "throughput" }, usage: { include: true }, response_format: { type: "json_object" }, messages }) });
    if (!response.ok) {
      // OpenRouter HTTP authentication/credit refusals precede generation.
      // This does NOT apply to errors inside HTTP 200 or to timeouts/429s.
      // If a refusal supplies usage, preserve it rather than assuming free.
      if ([401, 402].includes(response.status)) {
        const refusal = await response.json().catch(() => null);
        usage = refusal?.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
        preExecutionRejected = refusal?.usage == null;
      }
      if ([400, 401, 402, 403, 404, 429].includes(response.status)) fatalStatus = response.status;
      throw new Error(modelError(connection.label, response.status));
    }
    const result = await response.json(); usage = result.usage;
    if (result.error) { const status = Number(result.error.code) || 502; if ([400, 401, 402, 403, 404, 429].includes(status)) fatalStatus = status; throw new Error(modelError(connection.label, status)); }
    if (result.choices?.[0]?.finish_reason !== "stop") { truncated = result.choices?.[0]?.finish_reason === "length"; throw new Error("The model response was truncated or did not finish normally. No partial knowledge was accepted."); }
    const parsed = JSON.parse(result.choices?.[0]?.message?.content ?? "");
    const context = { passageIds: batch.passageIds, candidate: batch.candidate, review: batch.review };
    if (batch.phase === "extract") { const response = parseKnowledgeResponse("extract", parsed, context); extracted = response.value; validationHolds = response.holds; }
    else if (batch.phase === "review") { const response = parseKnowledgeResponse("review", parsed, context); reviewedCandidate = response.value; validationHolds = response.holds; }
    else {
      if (!batch.candidate) throw new Error("The extraction candidate was not saved; retry this batch.");
      if (!batch.review) throw new Error("The omission review was not saved; retry this batch.");
      const response = parseKnowledgeResponse("verify", parsed, context); validationHolds = response.holds;
      const held = [...(batch.validationHolds ?? []), ...validationHolds];
      const keys = new Set(held.flatMap(hold => hold.teachingKey ? [hold.teachingKey] : []));
      const verification = { ...response.value, teachings: response.value.teachings.filter(check => !keys.has(check.key)) };
      reviewed = independentlyVerifiedFragment(batch.candidate, batch.review, verification, passages, id, corpus);
      const unresolved = new Set(held.flatMap(hold => hold.passageIds));
      for (const audit of reviewed.audits) if (unresolved.has(audit.passageId)) { audit.disposition = "unresolved"; audit.reason = "One or more model entries failed validation and were saved in the private review archive. Independently verified teachings were kept; this passage is not marked complete."; }
      if (held.length) reviewed.warnings.push(`${held.length} model entry/entries held in private review because their format or required verification fields were invalid. Valid entries still required independent evidence and usefulness checks; affected passages remain unresolved.`);
      if (validationHolds.length) await writeRecord(brainKey(brainId, `knowledge/review/${id}-${batch.id}-${batch.revision}-verify-${token}.json`), { phase: batch.phase, rawResponse: parsed, validationHolds, imageIds: passages.map(passage => passage.image?.id).filter(Boolean) });
      if (reviewed.audits.some(audit => audit.disposition === "unresolved")) await writeRecord(brainKey(brainId, `knowledge/review/${id}-${batch.id}-${batch.revision}.json`), { candidate: batch.candidate, review: batch.review, verification: parsed, audits: reviewed.audits, imageIds: passages.map(passage => passage.image?.id).filter(Boolean) });
      const current = await readJob(id, brainId);
      if (current.batches.find(b => b.id === batch.id)?.lease?.token !== token) throw new Error("This request lost its lease. No unowned result was saved.");
      receipt = await appendFragment(brainId, claimed, batch, reviewed, { ...accountedUsage(usage, batch.lease!.reservation), token });
    }
    if (batch.phase !== "verify" && validationHolds.length) await writeRecord(brainKey(brainId, `knowledge/review/${id}-${batch.id}-${batch.revision}-${batch.phase}-${token}.json`), { phase: batch.phase, rawResponse: parsed, validationHolds, imageIds: passages.map(passage => passage.image?.id).filter(Boolean) });
    resultAccepted = true;
  } catch (error) {
    if (!providerRequested) usage = { cost: 0, prompt_tokens: 0, completion_tokens: 0 };
    const schemaIssues = error instanceof Error && error.name === "ZodError" ? (error as unknown as { issues: { path: (string | number)[]; message: string }[] }).issues?.slice(0, 5).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") : "";
    failure = error instanceof Error && error.name === "ZodError" ? `The model returned invalid extraction data. No partial result was accepted. ${schemaIssues}`.slice(0, 500) : error instanceof SyntaxError ? "The model returned malformed JSON. No partial result was accepted." : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "The model timed out; this bounded call may have been billed. Progress is saved and the batch can retry." : error instanceof Error ? error.message.slice(0, 500) : "The extraction request failed.";
    failure = failure.replace(/Bearer\s+\S+|sk-(?:or-)?[\w-]+/gi, "[redacted]");
  }
  const accounted = accountedUsage(usage, batch.lease!.reservation);
  const final = await updateRecord(jobKey(brainId, id), claimed, job => {
    const currentBatch = job.batches.find(b => b.id === batch.id)!;
    if (currentBatch.lease?.token !== token) return job;
    applyAccounting(job, token, accounted);
    if (providerRequested && passages.some(passage => passage.image)) logActivity(job, "image-input", `Sent ${passages.filter(passage => passage.image).length} original page image(s) to ${job.model} for ${batch.phase}; source bytes matched the recorded SHA256 fingerprint.`, batch.passageIds);
    if (!accounted.measured && !preExecutionRejected) addWarning(job, "At least one call did not return a measured dollar cost. Safety spend includes conservative accounting rather than claiming exact provider billing.");
    if (preExecutionRejected) logActivity(job, "billing", "OpenRouter rejected this request for authentication or credits before generation. The unused reservation was released; no provider-reported cost was invented. Earlier spending and unresolved estimates were not changed.", batch.passageIds);
    currentBatch.lease = undefined;
    if (resultAccepted && validationHolds.length) {
      currentBatch.validationHolds = [...(currentBatch.validationHolds ?? []), ...validationHolds];
      logActivity(job, "validation-review", `${validationHolds.length} invalid model entry/entries saved for private review. Other entries continue through independent verification; affected passages will remain unresolved. No whole-batch format retry was queued.`, [...new Set(validationHolds.flatMap(hold => hold.passageIds))]);
    }
    if (resultAccepted && extracted) { currentBatch.candidate = extracted; currentBatch.phase = "review"; currentBatch.state = "pending"; currentBatch.attempts = 0; currentBatch.error = undefined; }
    else if (resultAccepted && reviewedCandidate) { currentBatch.review = reviewedCandidate; currentBatch.phase = "verify"; currentBatch.state = "pending"; currentBatch.attempts = 0; currentBatch.error = undefined; }
    else if (resultAccepted && reviewed && receipt) {
      currentBatch.state = "done"; currentBatch.error = undefined; currentBatch.candidate = undefined; currentBatch.review = undefined;
      for (const audit of receipt.audits ?? []) { const offset = job.passages.findIndex(p => p.passageId === audit.passageId); if (offset >= 0) job.passages[offset] = audit; }
      job.nodesAdded += receipt.nodes; job.edgesAdded += receipt.edges;
      for (const warning of receipt.warnings ?? []) addWarning(job, warning);
      for (const question of [...(batch.candidate?.clarifications ?? []), ...(batch.review?.clarifications ?? [])]) {
        const evidence = validatedEvidence([{ passageId: question.passageId, quote: question.quote }], passages);
        if (!evidence) continue;
        const questionId = hash(`${question.passageId}|${question.question}`).slice(0, 24);
        if (!(job.questions ?? []).some(saved => saved.id === questionId)) job.questions = [...(job.questions ?? []), { ...question, quote: evidence[0].quote, id: questionId, pass: job.scanPass ?? 1 }];
      }
      logActivity(job, "accepted", `${receipt.nodes} new knowledge nodes and ${receipt.edges} connections saved after independent verification. ${receipt.audits?.filter(audit => audit.disposition === "unresolved").length ?? 0} passage(s) still need review.`, batch.passageIds);
    } else {
      if (truncated && currentBatch.passageIds.length > 1) {
        const offset = job.batches.indexOf(currentBatch);
        const parts: Batch[] = currentBatch.passageIds.map((passageId, index) => ({ id: `${currentBatch.id}.split${index}`, passageIds: [passageId], phase: "extract", state: "pending", attempts: 0, revision: currentBatch.revision + 1 }));
        job.batches.splice(offset, 1, ...parts);
        addWarning(job, "A truncated batch was split into individual passages for complete extraction and independent review. Its spent cost remains counted; no partial nodes were accepted.");
        job.error = "An oversized model response was safely split into smaller batches.";
      } else { currentBatch.error = failure; currentBatch.state = fatalStatus && fatalStatus !== 429 || currentBatch.attempts >= MAX_ATTEMPTS ? "failed" : "pending"; job.error = failure; }
      if (currentBatch.state === "failed") for (const audit of job.passages) if (currentBatch.passageIds.includes(audit.passageId)) { audit.disposition = "unresolved"; audit.reason = `Repeated ${currentBatch.phase} failure: ${failure}`; }
      if (fatalStatus) job.stage = fatalStatus === 429 ? "paused" : "failed";
      else if (providerRequested && !accounted.measured) {
        job.stage = "paused";
        job.error = `${failure} Billing is uncertain, so no automatic paid retry will start. The conservative estimate and saved checkpoint are retained; review spending before explicitly resuming.`;
      }
    }
    if (!resultAccepted) logActivity(job, "attention", job.error || failure, batch.passageIds);
    if (job.costUsd > job.budgetUsd) { job.stage = "paused-budget"; job.error = "Reported provider usage exceeded its conservative reservation. Extraction stopped; no further calls will be made."; }
    else updateStage(job);
    job.updatedAt = stamp(); return job;
  });
  return summary(final);
}
