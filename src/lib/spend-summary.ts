export interface ProviderSpend { totalUsd: number | null; todayUtcUsd: number | null; monthUsd: number | null; keyLimitRemainingUsd: number | null; }
export interface SpendReport {
  checkedAt: string; provider: string; providerSpend: ProviderSpend | null; providerError?: string;
  extraction: { trackedUsd: number; measuredUsd: number; estimatedUsd: number; reservedUsd: number; latestJob: { spentUsd: number; capUsd: number } | null };
}
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function parseProviderSpend(input: unknown): ProviderSpend {
  const data = input && typeof input === "object" && "data" in input ? (input as { data: Record<string, unknown> }).data : null;
  return { totalUsd: amount(data?.usage), todayUtcUsd: amount(data?.usage_daily), monthUsd: amount(data?.usage_monthly), keyLimitRemainingUsd: amount(data?.limit_remaining) };
}
