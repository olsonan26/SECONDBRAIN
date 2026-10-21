import test from "node:test";
import assert from "node:assert/strict";
import { parseProviderSpend } from "../src/lib/spend-summary";

test("provider spending preserves actual zero and never invents zero from missing, null or invalid usage", () => {
  assert.deepEqual(parseProviderSpend({ data: { usage: 0, usage_daily: .0482148, usage_monthly: 1.25, limit_remaining: null } }), { totalUsd: 0, todayUtcUsd: .0482148, monthUsd: 1.25, keyLimitRemainingUsd: null });
  assert.deepEqual(parseProviderSpend({ data: { usage: "3.5", usage_daily: -1, usage_monthly: NaN, limit_remaining: Infinity } }), { totalUsd: null, todayUtcUsd: null, monthUsd: null, keyLimitRemainingUsd: null });
  assert.equal(parseProviderSpend(null).totalUsd, null);
  assert.equal(parseProviderSpend({ data: null }).totalUsd, null);
});
