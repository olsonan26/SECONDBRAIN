"use client";

import { useCallback, useEffect, useState } from "react";
import type { KnowledgeJobSummary } from "@/lib/types";

interface Activity {
  events: { at: string; pass: number; phase: string; message: string; passageIds: string[] }[];
  audits: { passageId: string; page: number | null; disposition: string; reason: string }[];
  questions: { id: string; question: string; reason: string; quote: string; answer?: "include" | "exclude" }[];
}

export default function KnowledgeJobControls({ job, brainId, isOwner, disabled, onPause, onNextPass }: { job: KnowledgeJobSummary; brainId: string; isOwner: boolean; disabled: boolean; onPause: () => void; onNextPass: () => void }) {
  const [open, setOpen] = useState(false), [activity, setActivity] = useState<Activity | null>(null), [error, setError] = useState("");
  const pass = job.scanPass ?? 1;
  const finished = ["complete", "needs-review"].includes(job.stage);
  const endpoint = `/api/knowledge/jobs/${encodeURIComponent(job.id)}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`${endpoint}/activity?brain=${encodeURIComponent(brainId)}`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the decision log.");
    if (!signal?.aborted) { setActivity(data); setError(""); }
  }, [endpoint, brainId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      if (!active || inFlight || document.hidden) return;
      inFlight = true;
      try { await load(controller.signal); }
      catch (error) { if (active) setError(error instanceof Error ? error.message : "Could not refresh the decision log."); }
      finally { inFlight = false; if (active && !document.hidden) timer = setTimeout(poll, ["running", "queued"].includes(job.stage) ? 7000 : 60_000); }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { active = false; controller.abort(); document.removeEventListener("visibilitychange", visibility); clearTimeout(timer); };
  }, [open, load, job.stage]);
  async function answer(questionId: string, answer: "include" | "exclude") {
    try {
      const response = await fetch(`${endpoint}/answer?brain=${encodeURIComponent(brainId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId, answer }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your preference.");
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the answer."); }
  }
  return <section className="knowledge-scan-controls" aria-label="Full-book scan controls">
    <h3>Full-book pass {pass} of 3</h3>
    <ol className="knowledge-pass-list">{["Discover every teaching", "Find missed knowledge", "Final coverage check"].map((label, index) => <li key={label} aria-current={pass === index + 1 ? "step" : undefined}><span>{index + 1}</span><div>{label}<small>{(job.completedPasses ?? []).includes(index + 1) ? "Pass finished; inspect any unresolved evidence" : pass === index + 1 ? "Current pass" : "Waiting for your instruction"}</small></div></li>)}</ol>
    <p>Each pass rereads the entire selected source and checks existing graph knowledge. Every batch also receives omission review and an independent evidence check. Three passes reduce omissions; they cannot guarantee perfect completeness.</p>
    {isOwner ? <div className="knowledge-scan-actions">{!finished ? <button className="button button-secondary" disabled={disabled || job.stage === "paused"} onClick={onPause}>Pause &amp; save checkpoint</button> : pass < 3 ? <button className="button button-primary" disabled={disabled || job.reservedUsd > 0} onClick={onNextPass}>Start pass {pass + 1}: {pass === 1 ? "find missed knowledge" : "final coverage check"}</button> : <span>All three passes finished. Check unresolved passages below.</span>}</div> : null}
    <p className="field-help">Knowledge, scan position and spending are saved automatically. Pause stops new calls; an in-flight call may finish and save. Resume never resets your spending. The same ${job.budgetUsd.toFixed(2)} cap covers all three passes. Keep this tab open while scanning; closing it stops new browser-driven calls without deleting saved work.</p>
    <details className="knowledge-details" onToggle={event => setOpen(event.currentTarget.open)}><summary>Activity, evidence decisions &amp; questions{job.openQuestions ? ` (${job.openQuestions} unanswered)` : ""}</summary>
      <p>These are task updates and concise evidence-based decisions—not private internal model reasoning.</p>
      {error ? <p role="alert">{error}</p> : null}
      {activity?.questions.slice(0, 100).map(question => <article className="knowledge-clarification" key={question.id}><h4>{question.question}</h4><p>{question.reason}</p><blockquote>{question.quote}</blockquote>{question.answer ? <p>Saved preference: {question.answer}. Source verification is still required.</p> : isOwner ? <div className="knowledge-scan-actions"><button className="button button-secondary" onClick={() => { void answer(question.id, "include"); }}>Yes, useful—include if supported</button><button className="button button-secondary" onClick={() => { void answer(question.id, "exclude"); }}>Not useful</button></div> : <p>Waiting for the owner’s preference.</p>}</article>)}
      {!activity ? <p>Loading the saved decision log…</p> : <><h4>Recent activity</h4>{activity.events.length ? <ul className="knowledge-activity-list">{activity.events.map((event, index) => <li key={`${event.at}-${index}`}><small>Pass {event.pass} · {event.phase} · {new Date(event.at).toLocaleString()}</small><p>{event.message}</p></li>)}</ul> : <p>Earlier work is saved. New scan events will appear here as work continues.</p>}<h4>Recent passage decisions</h4><ul className="knowledge-activity-list">{activity.audits.map(audit => <li key={audit.passageId}><small>{audit.page ? `PDF page ${audit.page}` : "Source passage"} · {audit.disposition}</small><p>{audit.reason}</p></li>)}</ul></>}
    </details>
  </section>;
}
