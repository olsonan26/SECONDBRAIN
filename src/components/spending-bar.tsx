"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SpendReport } from "@/lib/spend-summary";

const dollars = (value: number | null | undefined) => value == null ? "Unavailable" : `$${value.toFixed(4)}`;
export default function SpendingBar({ brainId }: { brainId: string }) {
  const [report, setReport] = useState<SpendReport | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/spending?brain=${encodeURIComponent(brainId)}`, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not refresh spending.");
      if (!signal?.aborted) { setReport(data); setError(""); }
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Could not refresh spending."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [brainId]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  const latest = report?.extraction.latestJob;
  return <section className="spending-bar" aria-label="Model spending">
    <div className="spending-figures" aria-live="polite"><span>API key spent <strong>{dollars(report?.providerSpend?.totalUsd)}</strong></span><span>This brain’s extraction <strong>{dollars(report?.extraction.trackedUsd)}</strong></span>{latest ? <span className="spending-meter"><progress aria-label="Latest extraction job spending against its saved cap" value={Math.min(latest.spentUsd, latest.capUsd)} max={latest.capUsd} /><small>{dollars(latest.spentUsd)} / ${latest.capUsd.toFixed(2)} cap</small></span> : null}</div>
    <button className="button button-secondary" disabled={busy} onClick={() => { void refresh(); }} aria-label="Refresh spending"><RefreshCw size={13} className={busy ? "spin" : ""} />{busy ? "Updating…" : "Refresh spend"}</button>
    <div className="spending-detail"><small>{report ? `Updated ${new Date(report.checkedAt).toLocaleTimeString()}.` : "Fetching saved usage…"} {error ? "Last successful values retained; this refresh failed." : ""} API key usage includes other activity using this key and may have a reporting delay. Extraction spend includes conservative estimates; neither figure is your account balance.</small>{report?.extraction.estimatedUsd ? <small>{dollars(report.extraction.estimatedUsd)} of extraction spend is estimated; {dollars(report.extraction.measuredUsd)} is provider-reported.</small> : null}{report?.extraction.reservedUsd ? <small>{dollars(report.extraction.reservedUsd)} reserved for in-flight extraction calls.</small> : null}{report?.providerError ? <small role="status">{report.providerError}</small> : null}{error ? <small role="alert">{error}</small> : null}</div>
  </section>;
}
