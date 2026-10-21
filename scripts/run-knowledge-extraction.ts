import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

/** Explicit operator runner; durable state stays in the private brain. */
async function main() {
  const args = process.argv.slice(2), origin = args[0];
  const option = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const all = (flag: string) => args.flatMap((arg, i) => arg === flag ? [args[i + 1]] : []);
  const brain = option("--brain"), requestedJob = option("--job"), budget = Number(option("--budget") || 0);
  assert.ok(origin && brain, "Usage: run-knowledge-extraction.ts URL --brain UUID [--job UUID | --start --source ID --budget USD --requirements FILE ...]");
  assert.ok(!option("--budget") || (Number.isFinite(budget) && budget > 0 && budget <= 10), "The owner's hard spending ceiling is $10; a higher budget is not permitted.");
  const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
  const match = access.match(/Alex: username ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/);
  assert.ok(match, "Owner account not configured.");
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ username: match[1], password: match[2] }) });
  assert.equal(login.status, 200, "Owner sign-in failed.");
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  async function request(path: string, method = "GET", body?: unknown) {
    const r = await fetch(`${origin}/api/${path}${path.includes("?") ? "&" : "?"}brain=${encodeURIComponent(brain!)}`, {
      method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(115_000),
    });
    const data = await r.json().catch(() => ({ error: `HTTP ${r.status}: unreadable response` }));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  let id = requestedJob;
  if (!id) {
    assert.ok(args.includes("--start") && all("--source").length && budget > 0 && budget <= 10, "A paid job requires explicit --start, --source and --budget of at most $10.");
    const requirements = all("--requirements").map(file => readFileSync(file, "utf8")).join("\n\n");
    assert.ok(requirements.length <= 60_000, "Requirements exceed the request limit.");
    const job = await request("knowledge/jobs", "POST", { sourceIds: all("--source"), budgetUsd: budget, requirements });
    id = job.id;
    console.log(JSON.stringify({ event: "created", id, brain, budgetUsd: job.budgetUsd, totalPassages: job.totalPassages }));
  }
  assert.ok(id);
  const initial = await request(`knowledge/jobs/${id}`);
  assert.ok(initial.budgetUsd <= 10, "Existing job exceeds the owner's $10 ceiling; it will not be driven.");
  const workerCount = Math.max(1, Math.min(3, Number(option("--workers") || 3)));
  const maxSteps = Math.max(1, Math.min(2000, Number(option("--max-steps") || 1200)));
  let steps = 0, stopped = false, lastStamp = "";
  const terminal = new Set(["complete", "needs-review", "failed", "paused-budget", "paused"]);
  function report(job: Record<string, unknown>) {
    const stamp = JSON.stringify([job.stage, job.processedPassages, job.reviewedPassages, job.nodesAdded, job.unresolvedPassages, job.error]);
    if (stamp === lastStamp) return;
    lastStamp = stamp;
    console.log(JSON.stringify({ event: "progress", id, stage: job.stage, processed: job.processedPassages, reviewed: job.reviewedPassages, total: job.totalPassages, nodes: job.nodesAdded, edges: job.edgesAdded, unresolved: job.unresolvedPassages, costUsd: job.costUsd, measuredCostUsd: job.measuredCostUsd, estimatedCostUsd: job.estimatedCostUsd, reservedUsd: job.reservedUsd, error: job.error }));
  }
  async function worker() {
    let errors = 0;
    while (!stopped && steps < maxSteps) {
      steps++;
      try {
        const job = await request(`knowledge/jobs/${id}/step`, "POST");
        errors = 0; report(job);
        if (terminal.has(job.stage)) { stopped = true; return; }
        await new Promise(resolve => setTimeout(resolve, 450));
      } catch (error) {
        errors++;
        console.error(JSON.stringify({ event: "worker-error", id, attempt: errors, message: error instanceof Error ? error.message : "Request failed" }));
        if (errors >= 3) { stopped = true; process.exitCode = 1; return; }
        await new Promise(resolve => setTimeout(resolve, 4000 * errors));
      }
    }
  }
  report(initial);
  await Promise.all(Array.from({ length: workerCount }, worker));
  const final = await request(`knowledge/jobs/${id}`); report(final);
  console.log(JSON.stringify({ event: "runner-stopped", id, stage: final.stage, steps, pendingCount: final.pendingCount, resumable: !["complete", "needs-review"].includes(final.stage) }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Extraction runner failed"); process.exitCode = 1; });
