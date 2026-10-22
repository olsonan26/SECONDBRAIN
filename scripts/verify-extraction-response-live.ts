import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { RECOVERED_ASTROLOGY_ID, ORIGINAL_PHOTO_SOURCE_ID } from "../src/lib/fresh-scan-policy";

// Default is read-only. --check-resume exercises Resume with every /step
// intercepted locally, then restores Pause. No provider call is permitted.
async function main() {
  const origin = "https://secondbrain-nu-nine.vercel.app";
  const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
  try {
    for (const name of ["Alex", "Peter"]) {
      const credentials = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
      assert.ok(credentials);
      const context = await browser.newContext();
      try {
        const login = await context.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { username: credentials[1], password: credentials[2] } });
        assert.equal(login.status(), 200, `${name} login`);
        const workspaceResponse = await context.request.get(`${origin}/api/workspace?brain=${RECOVERED_ASTROLOGY_ID}`);
        assert.equal(workspaceResponse.status(), 200);
        const workspace = await workspaceResponse.json();
        assert.equal(workspace.recovery.extractionBlocked, false);
        const jobsResponse = await context.request.get(`${origin}/api/knowledge/jobs?brain=${RECOVERED_ASTROLOGY_ID}`);
        assert.equal(jobsResponse.status(), 200);
        const job = (await jobsResponse.json()).jobs.find((item: { id: string }) => item.id === workspace.recovery.freshScan.jobId);
        assert.ok(job);
        assert.equal(job.budgetUsd, 10);
        assert.equal(job.totalPassages, 1028);
        assert.equal(job.imagePassages, 1028);
        assert.deepEqual(job.sourceIds, [ORIGINAL_PHOTO_SOURCE_ID]);
        let blockedSteps = 0;
        await context.route("**/api/knowledge/jobs/*/step?**", async route => {
          blockedSteps++;
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...job, stage: "paused" }) });
        });
        const page = await context.newPage(), errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`${origin}/?brain=${RECOVERED_ASTROLOGY_ID}`);
        await page.getByRole("button", { name: "Knowledge extraction", exact: true }).click();
        await expect(page.getByRole("heading", { name: `Full-book pass ${job.scanPass ?? 1} of 3` })).toBeVisible({ timeout: 30000 });
        if (name === "Alex" && job.stage === "paused") await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
        if (name === "Peter") await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
        await expect(page.getByText("Cost controls: untouched adjacent photos share two-page batches;", { exact: false })).toBeVisible();
        assert.equal(errors.length, 0, "No browser runtime errors");
        assert.equal(blockedSteps, 0, "Opening the page must not start a paid scan");
        if (name === "Alex" && process.argv.includes("--check-resume")) {
          assert.equal(job.stage, "paused", "Never interrupt or automatically resume an active scan during verification");
          const endpoint = `${origin}/api/knowledge/jobs/${job.id}`;
          const before = await (await context.request.get(`${endpoint}?brain=${RECOVERED_ASTROLOGY_ID}`)).json();
          try {
            const responsePromise = page.waitForResponse(response => response.url().includes(`/${job.id}/resume?`) && response.request().method() === "POST");
            await page.getByRole("button", { name: "Resume", exact: true }).click();
            assert.equal((await responsePromise).status(), 200);
            await expect.poll(() => blockedSteps).toBeGreaterThan(0);
          } finally {
            await page.close();
            const pause = await context.request.post(`${endpoint}/pause?brain=${RECOVERED_ASTROLOGY_ID}`, { headers: { Origin: origin }, data: {} });
            assert.equal(pause.status(), 200);
          }
          const after = await (await context.request.get(`${endpoint}?brain=${RECOVERED_ASTROLOGY_ID}`)).json();
          assert.equal(after.stage, "paused");
          for (const key of ["costUsd", "budgetUsd", "nodesAdded", "processedPassages"]) assert.equal(after[key], before[key], `${key} must not change during a no-spend Resume test`);
          for (const saved of before.batches.filter((batch: { state: string; phase: string }) => batch.state === "done" || batch.phase !== "extract")) {
            const retained = after.batches.find((batch: { id: string }) => batch.id === saved.id);
            assert.ok(retained, "Existing completed/review batch identities must be retained");
            assert.deepEqual(retained.passageIds, saved.passageIds);
            assert.equal(retained.phase, saved.phase);
          }
          assert.equal(after.batches.flatMap((batch: { passageIds: string[] }) => batch.passageIds).length, 1028);
          console.log(JSON.stringify({ realResumeVerified: true, pairedBatches: after.batches.filter((batch: { passageIds: string[] }) => batch.passageIds.length === 2).length, savedProgressRetained: true, spendingUnchanged: true, restoredToPaused: true, paidCallsStarted: 0 }));
        }
        console.log(JSON.stringify({ account: name, login: "ok", extractionUI: "ok", stage: job.stage, pass: job.scanPass ?? 1, processed: job.processedPassages, nodesAdded: job.nodesAdded, costUsd: job.costUsd, budgetUsd: job.budgetUsd, browserErrors: errors.length, paidCallsStarted: 0 }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live verification failed"); process.exitCode = 1; });
