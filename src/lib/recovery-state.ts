import "server-only";
import { HttpError } from "./auth";
import { readRecord } from "./storage";
import { validBrainId } from "./brain-scope";
import { publicRecoveryState, RECOVERY_EXTRACTION_BLOCK_MESSAGE, type PublicRecoveryState } from "./recovery-state-core";

export { publicRecoveryState } from "./recovery-state-core";
export type { PublicRecoveryState } from "./recovery-state-core";

export async function getRecoveryState(): Promise<PublicRecoveryState | null> {
  const record = await readRecord<unknown>("recovery-state.json");
  return publicRecoveryState(record?.value);
}

/** Only browser navigation is redirected; APIs keep strict original brain boundaries. */
export async function recoveryBrainReplacement(brainId: string): Promise<string | null> {
  const record = await readRecord<Record<string, unknown>>("recovery-state.json");
  if (!record || !publicRecoveryState(record.value)?.pendingCloudRecovery || record.value.originalBrainId !== brainId) return null;
  const replacement = record.value.recoveredBrainId;
  return typeof replacement === "string" && replacement !== brainId && replacement !== "main" && validBrainId(replacement) ? replacement : null;
}

/** This guard performs only a metadata read. It never calls a model or edits a job. */
export async function assertExtractionRecoverySafe(): Promise<void> {
  const recovery = await getRecoveryState();
  if (recovery?.pendingCloudRecovery && recovery.extractionBlocked) throw new HttpError(409, RECOVERY_EXTRACTION_BLOCK_MESSAGE);
}
