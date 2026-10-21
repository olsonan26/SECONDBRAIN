export const RECOVERED_ASTROLOGY_ID = "5c9e08c7-21fd-4c8e-95a1-1c6830ff092d";
export const ORIGINAL_PHOTO_SOURCE_ID = "astrology-original-page-photographs";
export interface FreshScanAuthorization {
  version: 1;
  mode: "fresh-separate-budget";
  brainId: string;
  jobId: string;
  sourceId: string;
  sourceSha256: string;
  budgetUsd: number;
  authorizedAt: string;
  authorizedBy: "Alex";
  maxPasses: 3;
}
export function freshScanAuthorization(value: unknown): FreshScanAuthorization | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.mode !== "fresh-separate-budget" || v.brainId !== RECOVERED_ASTROLOGY_ID || v.sourceId !== ORIGINAL_PHOTO_SOURCE_ID || v.authorizedBy !== "Alex" || v.maxPasses !== 3 || typeof v.budgetUsd !== "number" || !Number.isFinite(v.budgetUsd) || v.budgetUsd <= 0 || v.budgetUsd > 10 || typeof v.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.jobId) || typeof v.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sourceSha256) || typeof v.authorizedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v.authorizedAt) || !Number.isFinite(Date.parse(v.authorizedAt))) return null;
  return { version: 1, mode: "fresh-separate-budget", brainId: v.brainId, jobId: v.jobId, sourceId: v.sourceId, sourceSha256: v.sourceSha256, budgetUsd: v.budgetUsd, authorizedAt: v.authorizedAt, authorizedBy: "Alex", maxPasses: 3 };
}
