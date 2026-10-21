import { chromium, expect, type BrowserContext, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { GraphNode, KnowledgeJobSummary, Workspace } from "../src/lib/types";
import { knowledgeNodeDetail, searchKnowledgeNodes } from "../src/lib/knowledge-graph";

const origin = process.argv[2] || "http://127.0.0.1:3102";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Mock knowledge verification is local-only.");
const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
function credentials(name: string) {
  const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  assert.ok(match, "Missing local test credentials");
  return { username: match[1], password: match[2] };
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    assert.equal((await context.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: credentials("Alex") })).status(), 200);
    const realWorkspaceResponse = await context.request.get(`${origin}/api/workspace?brain=main`);
    assert.equal(realWorkspaceResponse.status(), 200);
    const realWorkspace = await realWorkspaceResponse.json() as Workspace;
    assert.ok(realWorkspace.sources.length);
    const fixture: KnowledgeJobSummary = {
      id: "knowledge-ui-fixture", sourceIds: [realWorkspace.sources[0].id], author: "Alex", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      stage: "paused-budget", provider: "openrouter", model: "mock-model-no-paid-calls", totalPassages: 3, processedPassages: 2, pendingCount: 1, reviewedPassages: 1,
      excludedPassages: 1, unresolvedPassages: 1, nodesAdded: 5, edgesAdded: 4, costUsd: 0.0012, measuredCostUsd: 0.001, estimatedCostUsd: 0.0002, budgetUsd: 3, reservedUsd: 0,
      inputTokens: 100, outputTokens: 80, requirementsCount: 3, warnings: ["Fixture only. No actual AI calls occur."],
      coverage: [{ question: "How do delegates differ from rulers?", status: "candidate", nodeIds: ["teaching-0"] }, { question: "What does the book teach about profections?", status: "not-found", nodeIds: [] }, { question: "What does a retrograde planet mean?", status: "pending", nodeIds: [] }],
    };
    let job = structuredClone(fixture);
    let resumeBody: { budgetUsd?: number } | undefined;
    let stepCalls = 0, nextPassCalls = 0;
    let questionAnswer: "include" | "exclude" | undefined;
    const seenScopes: string[] = [];
    const mockGraph: GraphNode[] = Array.from({ length: 2305 }, (_, index) => ({ id: `teaching-${index}`, label: index === 0 ? "Unique teaching outside initial overview" : `Astrology teaching ${index}`, type: "teaching", knowledgeKind: "interpretation", layer: "uploaded", community: "Chart interpretation", sourceIds: [realWorkspace.sources[0].id], description: "A distinct, source-backed chart-reading teaching.", degree: index, evidence: [{ passageId: "knowledge-ui-evidence", sourceId: realWorkspace.sources[0].id, page: 42, quote: "This exact quotation is a local browser fixture, not real book content." }] }));
    const fulfill = (route: Route, payload: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    let spendingReads = 0, failSpending = false;
    await context.route("**/api/spending?**", route => {
      spendingReads++;
      if (failSpending) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Provider usage temporarily unavailable." }) });
      return fulfill(route, { checkedAt: new Date().toISOString(), provider: "openrouter", providerSpend: { totalUsd: spendingReads === 1 ? .05 : .06 }, extraction: { trackedUsd: .0482148, measuredUsd: .0482148, estimatedUsd: 0, reservedUsd: 0, latestJob: { spentUsd: .0482148, capUsd: 10 } } });
    });
    await context.route("**/api/knowledge/jobs**", async route => {
      const url = new URL(route.request().url());
      seenScopes.push(url.searchParams.get("brain") || "missing");
      if (url.pathname.endsWith("/activity")) return fulfill(route, { events: [{ at: new Date().toISOString(), pass: 1, phase: "accepted", message: "Exact source evidence verified; saved checkpoint retained.", passageIds: [] }], audits: [{ passageId: "fixture", page: 42, disposition: "unresolved", reason: "Borderline teaching example requires a usefulness preference." }], questions: [{ id: "question-fixture", question: "Would this borderline teaching example be useful?", reason: "The example mixes a reusable rule with unrelated biography.", quote: "This exact quotation is a local browser fixture, not real book content.", answer: questionAnswer }] });
      if (url.pathname.endsWith("/answer")) { questionAnswer = route.request().postDataJSON().answer; return fulfill(route, job); }
      if (url.pathname.endsWith("/next-pass")) { nextPassCalls++; job = { ...job, stage: "queued", scanPass: (job.scanPass ?? 1) + 1, completedPasses: [1, ...(nextPassCalls > 1 ? [2] : [])], processedPassages: 0, reviewedPassages: 0, pendingCount: 3 }; return fulfill(route, job); }
      if (url.pathname.endsWith("/resume")) {
        resumeBody = route.request().postDataJSON() || undefined;
        job = { ...job, stage: "queued", budgetUsd: resumeBody?.budgetUsd || job.budgetUsd };
        return fulfill(route, job);
      }
      if (url.pathname.endsWith("/step")) {
        stepCalls++;
        job = { ...job, stage: "complete", processedPassages: 3, reviewedPassages: 3, pendingCount: 0, unresolvedPassages: 0, nodesAdded: 8, edgesAdded: 6 };
        return fulfill(route, job);
      }
      if (url.pathname.endsWith("/pause")) { job = { ...job, stage: "paused" }; return fulfill(route, job); }
      return fulfill(route, { jobs: [job] });
    });
    await context.route("**/api/workspace**", route => fulfill(route, { ...realWorkspace, nodes: mockGraph, edges: [{ id: "fixture-edge", source: "teaching-0", target: "teaching-2304", relation: "explains", confidence: "EXTRACTED", score: 1, sourceIds: [realWorkspace.sources[0].id] }], stats: { ...realWorkspace.stats, nodes: mockGraph.length, edges: 1 } }));
    const graphCorpus = { ...realWorkspace, version: 1 as const, importedAt: "fixture", snapshotDate: "fixture", warnings: [], nodes: mockGraph, passages: [], edges: [{ id: "fixture-edge", source: "teaching-0", target: "teaching-2304", relation: "explains", confidence: "EXTRACTED" as const, score: 1, sourceIds: [realWorkspace.sources[0].id] }] };
    await context.route("**/api/knowledge/nodes?**", route => {
      const url = new URL(route.request().url());
      return fulfill(route, searchKnowledgeNodes(graphCorpus, url.searchParams.get("q") || "", Number(url.searchParams.get("offset") || 0), 50));
    });
    await context.route("**/api/knowledge/node?**", route => {
      const url = new URL(route.request().url());
      return fulfill(route, knowledgeNodeDetail(graphCorpus, url.searchParams.get("id") || ""));
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    const spending = page.getByRole("region", { name: "Model spending" });
    await expect(spending).toContainText("$0.0500");
    await spending.getByRole("button", { name: "Refresh spending" }).click();
    await expect(spending).toContainText("$0.0600");
    await expect(spending.getByRole("progressbar")).toHaveAttribute("max", "10");
    failSpending = true;
    await spending.getByRole("button", { name: "Refresh spending" }).click();
    await expect(spending.getByRole("alert")).toContainText("temporarily unavailable");
    await expect(spending).toContainText("$0.0600");
    failSpending = false;
    console.log("PASS: Spend refresh updates actual usage, keeps the cap separate, and retains last successful values on failure without inventing zero.");
    await page.getByRole("button", { name: "Knowledge extraction", exact: true }).click();
    const panel = page.locator(".knowledge-extraction");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Budget limit reached", { exact: true })).toBeVisible();
    await expect(panel.getByRole("progressbar", { name: "Passages processed" })).toHaveAttribute("value", "2");
    await expect(panel.getByRole("progressbar", { name: "Passages reviewed" })).toHaveAttribute("value", "1");
    await expect(panel.getByText(/provider-reported/)).toContainText("$0.0010 provider-reported");
    await panel.getByText(/Question coverage:/).click();
    await expect(panel.getByText("Not found in extracted evidence", { exact: true })).toBeVisible();
    await expect(panel.getByText(/Candidate means/)).toBeVisible();
    await panel.getByLabel("Raise this job’s total cap (USD)").fill("10");
    await panel.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(panel.getByText("Processing finished", { exact: true })).toBeVisible();
    assert.equal(resumeBody?.budgetUsd, 10, "Explicit per-job cap must reach the API");
    assert.equal(stepCalls, 1);
    assert.ok(seenScopes.every(scope => scope === "main"));
    console.log("PASS: Owner can see real counts, candidate/not-found coverage, explicitly raise a paused job cap, and run one safely mocked step.");
    assert.equal(nextPassCalls, 0, "Completing a pass must not automatically start the next one");
    await expect(panel.getByRole("heading", { name: "Full-book pass 1 of 3" })).toBeVisible();
    await panel.getByRole("button", { name: "Start pass 2: find missed knowledge" }).click();
    await expect(panel.getByRole("heading", { name: "Full-book pass 2 of 3" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Start pass 3: final coverage check" })).toBeVisible();
    assert.equal(nextPassCalls, 1);
    assert.equal(job.budgetUsd, 10);
    await panel.getByRole("button", { name: "Start pass 3: final coverage check" }).click();
    await expect(panel.getByText("All three passes finished. Check unresolved passages below.")).toBeVisible();
    assert.equal(nextPassCalls, 2);
    assert.equal(stepCalls, 3);
    await panel.getByText("Activity, evidence decisions & questions", { exact: true }).click();
    await expect(panel.getByText("Exact source evidence verified; saved checkpoint retained.")).toBeVisible();
    await panel.getByRole("button", { name: "Yes, useful—include if supported" }).click();
    await expect(panel.getByText("Saved preference: include. Source verification is still required.")).toBeVisible();
    assert.equal(stepCalls, 3, "Answering a question must not run another paid step");
    console.log("PASS: All three whole-book passes require owner clicks, retain the cap, and show sourced decision logs and saved usefulness answers.");

    await page.getByRole("button", { name: "The brain", exact: true }).click();
    await expect(page.locator(".graph-scene-summary")).toContainText("1,800 of 2,305 nodes shown");
    await page.getByRole("button", { name: "Browse all 2,305 nodes" }).click();
    await page.getByLabel("Search all knowledge nodes").fill("Unique teaching outside");
    await page.getByRole("button", { name: /Unique teaching outside initial overview/ }).click();
    await expect(page.locator(".graph-scene-summary")).toContainText("2 of 2,305 nodes shown");
    await expect(page.locator(".knowledge-node-evidence")).toContainText("Page 42");
    await expect(page.locator(".knowledge-node-evidence blockquote")).toContainText("local browser fixture");
    console.log("PASS: All 2,305 nodes remain searchable; an off-overview teaching and its neighbor are pinned, with exact page/quote evidence.");
    await page.screenshot({ path: "test-results/knowledge-nodes-desktop.png", fullPage: true });
    await page.getByRole("button", { name: "Close inspector selection" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Knowledge extraction", exact: true }).click();
    await expect(panel).toBeVisible();
    await page.screenshot({ path: "test-results/knowledge-progress-mobile.png", fullPage: true });
    const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > window.innerWidth + 1).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, parent: element.parentElement?.className, position: getComputedStyle(element).position, right: element.getBoundingClientRect().right })) }));
    assert.ok(overflow.scroll <= overflow.width + 1, `Mobile page overflows horizontally: ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: "test-results/knowledge-progress-mobile.png", fullPage: true });

    const peter = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    assert.equal((await peter.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: credentials("Peter") })).status(), 200);
    await peter.route("**/api/knowledge/jobs**", route => fulfill(route, { jobs: [fixture] }));
    const memberPage = await peter.newPage();
    await memberPage.goto(origin);
    await memberPage.getByRole("button", { name: "Knowledge extraction", exact: true }).click();
    await expect(memberPage.locator(".knowledge-extraction")).toContainText("Budget limit reached");
    assert.equal(await memberPage.locator(".knowledge-extraction").getByRole("button", { name: /Start paid|Resume|Pause|Continue here/ }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: Mobile panel fits and Peter can observe shared progress without paid owner controls. No provider or production writes occurred.");
    await peter.close();
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
