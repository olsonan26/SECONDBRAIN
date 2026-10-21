import "server-only";
import { HttpError } from "./auth";
import { readRecord } from "./storage";
import { validBrainId } from "./brain-scope";
import { freshScanAuthorization } from "./fresh-scan-policy";
import { publicRecoveryState, RECOVERY_EXTRACTION_BLOCK_MESSAGE, type PublicRecoveryState } from "./recovery-state-core";

export { publicRecoveryState } from "./recovery-state-core";
export type { PublicRecoveryState } from "./recovery-state-core";

export async function getRecoveryState(brainId?: string): Promise<PublicRecoveryState | null> {
  const record = await readRecord<unknown>("recovery-state.json");
  const state = publicRecoveryState(record?.value);
  if (state?.pendingCloudRecovery && state.restoredAt && brainId) {
    const freshScan = freshScanAuthorization((await readRecord<unknown>("recovery-fresh-scan.json"))?.value);
    if (freshScan?.brainId === brainId) return { ...state, extractionBlocked: false, freshScan, message: `Original Vercel-only work still awaits recovery. A separate fresh image-backed scan is authorized here with a new $${freshScan.budgetUsd.toFixed(2)} total cap across all three passes; earlier spending is not included or reset.` };
  }
  return state;
}

/** Only browser navigation is redirected; APIs keep strict original brain boundaries. */
export async function recoveryBrainReplacement(brainId: string): Promise<string | null> {
  const record = await readRecord<Record<string, unknown>>("recovery-state.json");
  if (!record || !publicRecoveryState(record.value)?.pendingCloudRecovery || record.value.originalBrainId !== brainId) return null;
  const replacement = record.value.recoveredBrainId;
  return typeof replacement === "string" && replacement !== brainId && replacement !== "main" && validBrainId(replacement) ? replacement : null;
}

/** This guard performs only a metadata read. It never calls a model or edits a job. */
export async function assertExtractionRecoverySafe(brainId?: string, jobId?: string) {
  const recovery = await getRecoveryState();
  if (recovery?.pendingCloudRecovery) {
    const fresh = freshScanAuthorization((await readRecord<unknown>("recovery-fresh-scan.json"))?.value);
    if (recovery.restoredAt && fresh && fresh.brainId === brainId && (!jobId || fresh.jobId === jobId)) return fresh;
    throw new HttpError(409, RECOVERY_EXTRACTION_BLOCK_MESSAGE);
  }
  return null;
}
