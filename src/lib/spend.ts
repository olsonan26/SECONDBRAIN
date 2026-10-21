import "server-only";
import { getSettings } from "./model";
import { listKnowledgeJobs } from "./knowledge";
import { parseProviderSpend, type SpendReport } from "./spend-summary";
import { getRecoveryState } from "./recovery-state";

export async function getSpending(brainId: string): Promise<SpendReport> {
  const [settings, jobs, recovery] = await Promise.all([getSettings(), listKnowledgeJobs(brainId), getRecoveryState()]);
  const report: SpendReport = { checkedAt: new Date().toISOString(), provider: settings.provider, providerSpend: null, extraction: {
    trackedUsd: jobs.reduce((sum, job) => sum + job.costUsd, 0), measuredUsd: jobs.reduce((sum, job) => sum + job.measuredCostUsd, 0), estimatedUsd: jobs.reduce((sum, job) => sum + job.estimatedCostUsd, 0), reservedUsd: jobs.reduce((sum, job) => sum + job.reservedUsd, 0), latestJob: jobs[0] ? { spentUsd: jobs[0].costUsd, capUsd: jobs[0].budgetUsd } : null,
  } };
  if (recovery?.pendingCloudRecovery) {
    report.historyIncomplete = true;
    report.extraction = { trackedUsd: null, measuredUsd: null, estimatedUsd: null, reservedUsd: null, latestJob: null };
  }
  if (settings.provider !== "openrouter" || !settings.apiKey) { report.providerError = "Connect OpenRouter to read this API key’s provider-reported spending."; return report; }
  try {
    // Read-only usage endpoint. This does not run a model or purchase credits.
    const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${settings.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Provider usage unavailable (${response.status}).`);
    report.providerSpend = parseProviderSpend(await response.json());
    report.providerCheckedAt = new Date().toISOString();
  } catch (error) { report.providerError = error instanceof Error && error.message.startsWith("Provider usage unavailable") ? error.message : "Could not refresh provider spending. Try again shortly."; }
  report.checkedAt = new Date().toISOString();
  return report;
}
