"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertCircle, BookOpen, Check, ChevronDown, LoaderCircle, Network, Pause, Play, RefreshCw, Sparkles } from "lucide-react";
import type { GraphNode, Source, KnowledgeJobSummary, KnowledgeStage } from "@/lib/types";
import KnowledgeJobControls from "./knowledge-job-controls";

interface ExtractionProps {
  brainId: string;
  sources: Source[];
  isOwner: boolean;
  extractionBlocked?: boolean;
  freshScan?: { jobId: string; sourceId: string; budgetUsd: number };
  onGraphChanged?: () => void | Promise<void>;
  onAskQuestion?: (question: string) => void;
  requirements?: string;
  profileName?: string;
}

const number = new Intl.NumberFormat("en-US");
const money = (value: number) => `$${Math.max(0, value || 0).toFixed(4)}`;
const stageLabel: Record<KnowledgeStage, string> = {
  queued: "Ready to extract", running: "Extraction in progress", paused: "Paused", "paused-budget": "Budget limit reached",
  complete: "Processing finished", "needs-review": "Processing finished with unresolved passages", failed: "Needs attention",
};
const isActive = (job: KnowledgeJobSummary) => job.stage === "running" || job.stage === "queued";

async function request<T>(brainId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/knowledge/jobs${path}?brain=${encodeURIComponent(brainId)}`, {
    method, signal, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ error: "The extraction server returned an unreadable response. Your saved progress is unchanged." }));
  if (!response.ok) throw new Error(payload.error || "Could not update this extraction job.");
  return payload as T;
}

function Progress({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total ? Math.min(100, Math.round(value / total * 100)) : 0;
  return <div className="knowledge-progress"><div><span>{label}</span><strong>{number.format(value)} / {number.format(total)}</strong></div><progress aria-label={label} max={Math.max(1, total)} value={value} /><small>{percent}%</small></div>;
}

export default function KnowledgeExtraction({ brainId, sources, isOwner, extractionBlocked = false, freshScan, onGraphChanged, onAskQuestion, requirements = "", profileName }: ExtractionProps) {
  const formId = useId();
  const [jobs, setJobs] = useState<KnowledgeJobSummary[]>([]);
  const [sourceId, setSourceId] = useState(freshScan?.sourceId || sources[0]?.id || "");
  const [instructions, setInstructions] = useState(requirements);
  const [budget, setBudget] = useState(String(freshScan?.budgetUsd ?? 3));
  const [resumeBudgets, setResumeBudgets] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [driving, setDriving] = useState<string | null>(null);
  const [expandedCoverage, setExpandedCoverage] = useState<string | null>(null);
  const [coverageLimit, setCoverageLimit] = useState(40);
  const driver = useRef<string | null>(null);
  const driverVersion = useRef(0);
  const callback = useRef(onGraphChanged);
  const mounted = useRef(true);
  const graphStamp = useRef("");
  const graphRefreshUntil = useRef(0);
  const pollingDelay = useRef(60_000);
  useEffect(() => { callback.current = onGraphChanged; }, [onGraphChanged]);
  useEffect(() => {
    if (!extractionBlocked) return;
    driver.current = null;
    driverVersion.current++;
    setDriving(null);
  }, [extractionBlocked]);

  const updateJobs = useCallback((next: KnowledgeJobSummary[]) => {
    if (!mounted.current) return;
    setJobs(next);
    const stamp = next.map(job => `${job.id}:${job.nodesAdded}:${job.edgesAdded}`).join("|");
    // Another server instance may briefly retain an older corpus cache after a
    // checkpoint. Reconcile for 30 seconds, including the first progress load,
    // so pausing immediately after a save cannot leave the last nodes invisible.
    if (graphStamp.current !== stamp) graphRefreshUntil.current = Date.now() + 30_000;
    pollingDelay.current = next.some(isActive) || Date.now() < graphRefreshUntil.current ? 7000 : 60_000;
    if (next.length && Date.now() < graphRefreshUntil.current) void Promise.resolve().then(() => callback.current?.()).catch(() => {});
    graphStamp.current = stamp;
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await request<{ jobs: KnowledgeJobSummary[] }>(brainId, "", "GET", undefined, signal);
    if (!signal?.aborted) updateJobs(result.jobs);
  }, [brainId, updateJobs]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled || inFlight || document.hidden) return;
      if (driver.current) { timer = setTimeout(poll, 7000); return; }
      inFlight = true;
      try { await load(controller.signal); }
      catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load extraction progress."); }
      finally {
        inFlight = false;
        if (!cancelled) { setLoading(false); if (!document.hidden) timer = setTimeout(poll, pollingDelay.current); }
      }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { cancelled = true; controller.abort(); document.removeEventListener("visibilitychange", visibility); mounted.current = false; driver.current = null; driverVersion.current++; clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (!sourceId && sources[0]) setSourceId(sources[0].id);
  }, [sourceId, sources]);

  async function drive(job: KnowledgeJobSummary) {
    if (driver.current || !isOwner || extractionBlocked) return;
    driver.current = job.id;
    const version = ++driverVersion.current;
    setDriving(job.id);
    setError("");
    try {
      let current = job;
      while (driver.current === job.id && driverVersion.current === version && mounted.current && isActive(current)) {
        current = await request<KnowledgeJobSummary>(brainId, `/${encodeURIComponent(job.id)}/step`, "POST");
        if (!mounted.current) break;
        setJobs(previous => previous.map(item => item.id === current.id ? current : item));
        await load();
        // A second browser or the command-line worker may already hold the server lease.
        // A short yield keeps the owner control responsive without duplicate paid calls.
        if (driver.current === job.id && driverVersion.current === version && isActive(current)) await new Promise(resolve => setTimeout(resolve, 600));
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Extraction stopped. Your completed work is saved; retry when ready.");
    } finally {
      if (driverVersion.current === version) { driver.current = null; if (mounted.current) setDriving(null); }
      if (mounted.current) await load().catch(() => {});
    }
  }

  async function control(job: KnowledgeJobSummary, action: "pause" | "resume") {
    if (action === "resume" && extractionBlocked) return;
    setBusy(job.id);
    setError("");
    if (action === "pause") { driver.current = null; driverVersion.current++; setDriving(null); }
    try {
      const updated = await request<KnowledgeJobSummary>(brainId, `/${encodeURIComponent(job.id)}/${action}`, "POST", action === "resume" && job.stage === "paused-budget" && resumeBudgets[job.id] !== undefined ? { budgetUsd: Number(resumeBudgets[job.id]) } : undefined);
      await load();
      if (action === "resume") void drive(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change extraction progress."); }
    finally { setBusy(null); }
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceId || !isOwner || extractionBlocked || busy || driving) return;
    setBusy("create");
    setError("");
    try {
      const job = await request<KnowledgeJobSummary>(brainId, "", "POST", { sourceIds: [sourceId], requirements: instructions, budgetUsd: Number(budget) });
      await load();
      void drive(job);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start knowledge extraction."); }
    finally { setBusy(null); }
  }

  async function nextPass(job: KnowledgeJobSummary) {
    if (extractionBlocked) return;
    setBusy(job.id); setError("");
    try {
      const updated = await request<KnowledgeJobSummary>(brainId, `/${encodeURIComponent(job.id)}/next-pass`, "POST", {});
      await load(); void drive(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the next pass."); }
    finally { setBusy(null); }
  }

  return <section className="knowledge-extraction" aria-labelledby={`${formId}-heading`}>
    <div className="knowledge-heading"><span className="knowledge-symbol"><Network size={20} /></span><div><h2 id={`${formId}-heading`}>Turn the book into connected knowledge.</h2><p>Individual teachings, definitions, techniques, and formulas—with their exact supporting text.</p></div><button className="icon-button" aria-label="Refresh extraction progress" onClick={() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Could not refresh progress.")); }}><RefreshCw size={15} /></button></div>
    {extractionBlocked ? <p className="knowledge-error" role="status"><AlertCircle size={15} />New AI scanning is locked while the previous scan checkpoint and spending ledger await recovery. Your source library is available. We will not start a replacement scan or assume that the original budget is unused.</p> : null}
    {error ? <p className="knowledge-error" role="alert"><AlertCircle size={15} />{error}</p> : null}
    {loading ? <p className="knowledge-note" role="status"><LoaderCircle size={14} className="spin" />Loading saved extraction progress…</p> : null}
    {jobs.map(job => {
      const coverage = job.coverage || [];
      const supported = coverage.filter(item => item.status === "candidate").length;
      const needsAttention = job.unresolvedPassages > 0 || job.stage === "failed" || job.stage === "paused-budget";
      const canResume = !isActive(job) && job.stage !== "complete";
      return <article className={`knowledge-job ${needsAttention ? "needs-attention" : ""}`} key={job.id}>
        <div className="knowledge-job-heading"><div><strong>{job.sourceIds.map(id => sources.find(source => source.id === id)?.title || "Source document").join(", ")}</strong><span className={`knowledge-stage ${job.stage}`}>{driving === job.id ? <LoaderCircle size={12} className="spin" /> : job.stage === "complete" ? <Check size={12} /> : null}{stageLabel[job.stage]}</span></div>{isOwner ? <div className="knowledge-job-actions">{isActive(job) ? <><button className="button button-secondary" disabled={busy === job.id} onClick={() => { void control(job, "pause"); }}><Pause size={13} />Pause</button>{!driving ? <button className="button button-secondary" disabled={!!busy || extractionBlocked} onClick={() => { void drive(job); }}><Play size={13} />Continue here</button> : null}</> : canResume ? <button className="button button-secondary" disabled={!!busy || !!driving || extractionBlocked} onClick={() => { void control(job, "resume"); }}><Play size={13} />{job.stage === "failed" || job.stage === "needs-review" ? "Retry unresolved" : "Resume"}</button> : null}</div> : null}</div>
        <KnowledgeJobControls job={job} brainId={brainId} isOwner={isOwner} disabled={!!busy || extractionBlocked} onPause={() => { void control(job, "pause"); }} onNextPass={() => { void nextPass(job); }} />
        <div className="knowledge-progress-grid"><Progress label="Passages processed" value={job.processedPassages} total={job.totalPassages} /><Progress label="Passages reviewed" value={job.reviewedPassages} total={job.totalPassages} /></div>
        {job.imagePassages ? <><Progress label="Original page images fully reviewed" value={job.reviewedImages ?? 0} total={job.imagePassages} /><p className="knowledge-note">{number.format(job.imagePassages)} original images connected. Each image is sent for extraction, omission review, and independent support verification. OCR helps search; it does not replace image inspection.</p></> : null}
        <dl className="knowledge-counts"><div><dt>Knowledge nodes</dt><dd>{number.format(job.nodesAdded)}</dd></div><div><dt>Connections</dt><dd>{number.format(job.edgesAdded)}</dd></div><div><dt>Non-teaching passages</dt><dd>{number.format(job.excludedPassages)}</dd></div><div className={job.unresolvedPassages ? "attention" : ""}><dt>Unresolved passages</dt><dd>{number.format(job.unresolvedPassages)}</dd></div></dl>
        <div className="knowledge-budget"><span>{money(job.costUsd)} tracked usage <span>/ {money(job.budgetUsd)} cap</span><small>{money(job.measuredCostUsd)} provider-reported · {money(job.estimatedCostUsd)} estimated usage</small>{job.estimatedTotalCostUsd !== undefined ? <small>Initial full-job estimate: {money(job.estimatedTotalCostUsd)} (projection, not spend)</small> : null}{job.reservedUsd > 0 ? <small>{money(job.reservedUsd)} reserved for a call in progress</small> : null}</span><span>{job.currentPhase === "review" ? "Coverage review" : "Knowledge extraction"}<small>{job.model}</small></span></div>
        {isOwner && job.stage === "paused-budget" ? <div className="knowledge-resume-budget"><label htmlFor={`${formId}-resume-${job.id}`}>Raise this job’s total cap (USD)</label><input id={`${formId}-resume-${job.id}`} type="number" min={job.budgetUsd} max="10" step="0.1" value={resumeBudgets[job.id] ?? String(job.budgetUsd)} disabled={extractionBlocked} onChange={event => setResumeBudgets(previous => ({ ...previous, [job.id]: event.target.value }))} /><p>Resume applies only the cap you enter here. It does not buy credits or change your other jobs.</p></div> : null}
        {job.error ? <p className="knowledge-error"><AlertCircle size={14} />{job.error}</p> : null}
        {job.warnings?.length ? <details className="knowledge-details"><summary>{job.warnings.length} processing {job.warnings.length === 1 ? "note" : "notes"}<ChevronDown size={12} /></summary>{job.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
        {coverage.length ? <details className="knowledge-details" open={expandedCoverage === job.id} onToggle={event => { if (!event.currentTarget.open && expandedCoverage === job.id) setExpandedCoverage(null); }}><summary onClick={event => { event.preventDefault(); setExpandedCoverage(expandedCoverage === job.id ? null : job.id); setCoverageLimit(40); }}>Question coverage: {supported} of {coverage.length} have candidate evidence<ChevronDown size={12} /></summary><p>Candidate means the extracted graph has potentially relevant evidence—not a guarantee that it can answer every interpretation. Missing evidence stays visible.</p><p>Personal readings require actual chart data. This graph does not calculate a chart or verify private thoughts or medical causes.</p><ul className="knowledge-coverage">{coverage.slice(0, coverageLimit).map((item, index) => <li key={index}><span className={`coverage-indicator ${item.status}`}>{item.status === "candidate" ? <Check size={12} /> : item.status === "pending" ? "…" : "?"}</span><span>{item.question}<small>{item.status === "candidate" ? `${item.nodeIds.length} linked knowledge ${item.nodeIds.length === 1 ? "node" : "nodes"}` : item.status === "pending" ? "Pending extraction or review" : "Not found in extracted evidence"}</small></span>{item.status === "candidate" && onAskQuestion ? <button className="knowledge-question-ask" aria-label={`Ask: ${item.question}`} onClick={() => onAskQuestion(item.question)}>Ask</button> : null}</li>)}</ul>{coverageLimit < coverage.length ? <button className="text-button" onClick={() => setCoverageLimit(value => value + 40)}>Show more questions ({coverage.length - coverageLimit} remaining)</button> : null}</details> : null}
        <p className="knowledge-note">{job.stage === "complete" ? "All passages completed processing and review. This audit does not guarantee that AI found every possible teaching." : job.stage === "needs-review" ? "Unresolved passages remain visible. Review or retry them before treating extraction as finished." : driving === job.id ? "This browser is processing the next batch. Keep this tab open; pause safely or resume saved work later." : "Progress is saved for both Alex and Peter. An active worker may continue processing; use Continue here to drive it from this browser."}</p>
      </article>;
    })}
    {isOwner && (!freshScan || !jobs.some(job => job.id === freshScan.jobId)) ? <details className="knowledge-create" open={!jobs.length && !loading}><summary><Sparkles size={14} />{jobs.length ? "Extract another source" : "Start AI knowledge extraction"}<ChevronDown size={13} /></summary><form onSubmit={event => { void start(event); }}>
      <label className="field-label" htmlFor={`${formId}-source`}>Source to process</label><select id={`${formId}-source`} value={sourceId} onChange={event => setSourceId(event.target.value)} disabled={!!busy || !!driving || extractionBlocked} required>{!sources.length ? <option value="">Import a source first</option> : sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select>
      <div className="knowledge-budget-setting"><label className="field-label" htmlFor={`${formId}-budget`}>Maximum model spend (USD)</label><span>$<input id={`${formId}-budget`} aria-describedby={`${formId}-budget-help`} type="number" min="0.1" max="10" step="0.1" value={budget} disabled={extractionBlocked} onChange={event => setBudget(event.target.value)} required /></span></div><p className="field-help" id={`${formId}-budget-help`}>{extractionBlocked ? "The previous job’s saved budget and spending are unavailable until recovery. This form cannot create a replacement job." : "A spending guard, not a price quote. Used for new jobs; raising a paused job’s cap requires a separate owner action. Unfinished work pauses at the cap. Completed work stays saved."}</p>
      <details className="knowledge-details"><summary>{profileName || "Questions and extraction priorities"}<ChevronDown size={12} /></summary><label className="field-label" htmlFor={`${formId}-requirements`}>Additional questions or topics to audit</label><textarea id={`${formId}-requirements`} value={instructions} maxLength={60000} rows={5} disabled={extractionBlocked} onChange={event => setInstructions(event.target.value)} placeholder="List chart-reading questions, placements, aspects, formulas, rulership, delegates, profections, or other knowledge you want audited…" /><p className="field-help">Every passage is still processed. Questions guide the coverage audit; they do not replace source evidence.</p></details>
      <p className="knowledge-note"><BookOpen size={14} />Personal stories are excluded only when they do not teach a reusable rule or reading technique. Teaching examples retain their evidence.</p><button className="button button-primary" disabled={!sources.length || !sourceId || !!busy || !!driving || extractionBlocked}>{busy === "create" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{extractionBlocked ? "Scanning locked until recovery" : "Start paid AI extraction"}</button>
    </form></details> : !jobs.length && !loading ? <p className="knowledge-note">The workspace owner can start AI extraction. Saved knowledge and progress will be shared here.</p> : null}
  </section>;
}

export function KnowledgeNodeEvidence({ node, onOpenPassage, brainId = "main" }: { node: GraphNode; onOpenPassage: (passageId: string) => void; brainId?: string }) {
  const evidence = node.evidence;
  if (!evidence?.length) return null;
  return <section className="knowledge-node-evidence" aria-label="Evidence for this knowledge"><div className="section-label">Supporting evidence <span>{evidence.length}</span></div>{evidence.map((item, index) => <div key={`${item.passageId}-${index}`}><button className="knowledge-evidence-location" onClick={() => onOpenPassage(item.passageId)}><BookOpen size={13} />{item.page ? `Page ${item.page}` : "Open source passage"}<span>Open passage</span></button>{item.visualObservation ? <><small>Image observation — not a verbatim quotation</small><p>{item.visualObservation}</p></> : <blockquote>{item.quote}</blockquote>}{item.imageId ? <a className="text-button" href={`/api/source-image?brain=${encodeURIComponent(brainId)}&passage=${encodeURIComponent(item.passageId)}`} target="_blank" rel="noreferrer">View original page image</a> : null}</div>)}</section>;
}
