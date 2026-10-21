/** Public recovery metadata never includes private inventories, credentials or ledgers. */
export interface PublicRecoveryState {
  pendingCloudRecovery: boolean;
  message: string;
  extractionBlocked: boolean;
  sourceSnapshotDate: string | null;
  restoredAt: string | null;
}

export const RECOVERY_EXTRACTION_BLOCK_MESSAGE = "AI extraction is locked while the original scan checkpoint and spending ledger are awaiting recovery. Your recovered sources remain available for search. No new scan, checkpoint reset or spending reset was started.";

const pendingMessage = "Recovered source files are available. Original cloud-only drafts, accepted teachings, scan progress and historical spending still await recovery.";
const invalidMessage = "Recovery status could not be verified. Source files remain available, but AI extraction is locked to protect existing scan progress and spending.";

function date(value: unknown, dateOnly: boolean): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const normalized = parsed.toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value ? value : null;
}

/** A present but malformed recovery record fails closed, never into a fresh scan. */
export function publicRecoveryState(value: unknown): PublicRecoveryState | null {
  if (value === null || value === undefined) return null;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const sourceSnapshotDate = date(record?.sourceSnapshotDate, true);
  const restoredAt = date(record?.restoredAt, false);
  const sourceDateValid = record?.sourceSnapshotDate === null || record?.sourceSnapshotDate === undefined || record?.sourceSnapshotDate === "" || sourceSnapshotDate !== null;
  if (!record || record.version !== 1 || typeof record.pendingCloudRecovery !== "boolean" || typeof record.extractionBlocked !== "boolean" || record.pendingCloudRecovery !== record.extractionBlocked || !sourceDateValid || !restoredAt) {
    return { pendingCloudRecovery: true, extractionBlocked: true, sourceSnapshotDate: null, restoredAt: null, message: invalidMessage };
  }
  return {
    pendingCloudRecovery: record.pendingCloudRecovery,
    extractionBlocked: record.extractionBlocked,
    sourceSnapshotDate,
    restoredAt,
    message: record.pendingCloudRecovery ? pendingMessage : "The recovery restriction has been cleared.",
  };
}
