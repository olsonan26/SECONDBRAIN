import "server-only";
import { brainKey, MAIN_BRAIN_ID } from "./brain-scope";
import { getCorpus } from "./corpus";
import { readRecord, updateRecord } from "./storage";
import { parseQuestionRequirements, questionCoverage, type QuestionCoverageEntry, type QuestionRequirement, type RequirementInput } from "./knowledge-questions";

export interface QuestionProfile {
  version: 1;
  jobId: string;
  updatedAt: string;
  entries: QuestionRequirement[];
  warnings: string[];
}
export interface QuestionCoverageReport {
  jobId: string | null;
  updatedAt: string | null;
  entries: QuestionCoverageEntry[];
  summary: { questions: number; topics: number; candidate: number; notFound: number; pending: number };
  totalEntries: number;
  filteredEntries: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  warnings: string[];
}
export interface QuestionCoverageOptions { offset?: number; limit?: number; query?: string; summaryOnly?: boolean; }

export async function saveQuestionProfile(requirements: RequirementInput, jobId: string, brainId = MAIN_BRAIN_ID, warnings: readonly string[] = []): Promise<QuestionProfile> {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(jobId)) throw new Error("Invalid question profile job ID");
  const profile: QuestionProfile = {
    version: 1, jobId, updatedAt: new Date().toISOString(), entries: parseQuestionRequirements(requirements), warnings: [...new Set(warnings)],
  };
  return updateRecord<QuestionProfile>(brainKey(brainId, "knowledge-question-profile.json"), profile, () => profile);
}

export async function getQuestionProfile(brainId = MAIN_BRAIN_ID): Promise<QuestionProfile | null> {
  const record = await readRecord<QuestionProfile>(brainKey(brainId, "knowledge-question-profile.json"));
  return record?.value ?? null;
}

export async function getQuestionCoverage(brainId = MAIN_BRAIN_ID, options: QuestionCoverageOptions = {}): Promise<QuestionCoverageReport> {
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset!)) : 0;
  const limit = Number.isFinite(options.limit) ? Math.min(25, Math.max(1, Math.floor(options.limit!))) : 20;
  const profile = await getQuestionProfile(brainId);
  if (!profile) return { jobId: null, updatedAt: null, entries: [], summary: { questions: 0, topics: 0, candidate: 0, notFound: 0, pending: 0 }, totalEntries: 0, filteredEntries: 0, offset, limit, hasMore: false, warnings: [] };
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(profile.jobId)) throw new Error("Invalid stored question profile job ID");
  const [corpus, job] = await Promise.all([
    getCorpus(brainId),
    readRecord<{ stage: string; passages?: { disposition: string }[]; warnings?: string[] }>(brainKey(brainId, `knowledge/jobs/${profile.jobId}.json`)),
  ]);
  const pending = !job || !["complete", "needs-review"].includes(job.value.stage) || Boolean(job.value.passages?.some(passage => passage.disposition === "pending"));
  const entries = questionCoverage(corpus, profile.entries, { brainId, pending });
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const filtered = query ? entries.filter(entry => `${entry.text} ${entry.category}`.toLocaleLowerCase().includes(query)) : entries;
  const selected = options.summaryOnly ? filtered.map(entry => ({ ...entry, evidence: [], warnings: [] })) : filtered.slice(offset, offset + limit);
  const warnings = [...new Set([
    "Candidate links identify potentially relevant source-backed teachings; they do not verify a complete answer or exhaustive extraction.",
    "Personal chart interpretations require accurate chart data and an independently verified calculation method.",
    ...(pending ? ["Extraction is unfinished. Requirements with no accepted candidate remain pending, not established absences."] : []),
    ...profile.warnings, ...(job?.value.warnings ?? []),
  ])];
  return {
    jobId: profile.jobId, updatedAt: profile.updatedAt, entries: selected,
    totalEntries: entries.length, filteredEntries: filtered.length, offset: options.summaryOnly ? 0 : offset,
    limit: options.summaryOnly ? filtered.length : limit, hasMore: !options.summaryOnly && offset + selected.length < filtered.length,
    summary: {
      questions: entries.filter(entry => entry.kind === "question").length,
      topics: entries.filter(entry => entry.kind === "topic").length,
      candidate: entries.filter(entry => entry.status === "candidate").length,
      notFound: entries.filter(entry => entry.status === "not-found").length,
      pending: entries.filter(entry => entry.status === "pending").length,
    }, warnings,
  };
}
