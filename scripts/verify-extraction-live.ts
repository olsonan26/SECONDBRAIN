import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

async function main() {
  const origin = "https://secondbrain-nu-nine.vercel.app";
  const brainId = "a2f66ffe-ae02-40eb-a264-a5697dcb6c5b";
  const sourceId = "upload-5bd9e58b62009b1fedbc";
  const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
  let sharedSettingsHash = "";
  try {
    for (const name of ["Alex", "Peter"]) {
      const credentials = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
      assert.ok(credentials);
      const context = await browser.newContext();
      const login = await context.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { username: credentials[1], password: credentials[2] } });
      assert.equal(login.status(), 200);
      const workspace = await (await context.request.get(`${origin}/api/workspace?brain=${brainId}`)).json();
      assert.equal(workspace.brain.name, "Astrology");
      assert.equal(workspace.sources.length, 3);
      assert.ok(workspace.stats.teachings > 23);
      assert.equal(workspace.settings.provider, "openrouter");
      assert.equal(workspace.settings.connected, true);
      assert.ok(workspace.settings.writingInstructions.length > 4000);
      const settingsHash = createHash("sha256").update(JSON.stringify(workspace.settings)).digest("hex");
      if (sharedSettingsHash) assert.equal(settingsHash, sharedSettingsHash, "Both logins must share the same model connection and writing rules.");
      sharedSettingsHash = settingsHash;
      const main = await (await context.request.get(`${origin}/api/workspace?brain=main`)).json();
      assert.equal(main.sources.length, 74, "Main brain source count must remain unchanged.");
      const jobs = await (await context.request.get(`${origin}/api/knowledge/jobs?brain=${brainId}`)).json();
      const job = jobs.jobs.find((job: { id: string }) => job.id === "03478f99-4e19-4fa9-a376-899ec53f657c");
      assert.ok(job && job.nodesAdded >= 23 && job.budgetUsd === 10);
      assert.equal(job.imagePassages, 1028);
      assert.ok(job.reviewedImages >= 1);
      const spendingResponse = await context.request.get(`${origin}/api/spending?brain=${brainId}`);
      assert.equal(spendingResponse.status(), 200);
      const spending = await spendingResponse.json();
      assert.equal(spending.extraction.trackedUsd, job.costUsd);
      assert.equal(spending.extraction.latestJob.capUsd, 10);
      assert.ok(typeof spending.providerSpend?.totalUsd === "number", "Live provider spending should be available for the configured OpenRouter key.");
      const activityResponse = await context.request.get(`${origin}/api/knowledge/jobs/${job.id}/activity?brain=${brainId}`);
      assert.equal(activityResponse.status(), 200);
      const activity = await activityResponse.json();
      assert.ok(activity.audits.length >= 1);
      assert.ok(activity.events.some((event: { phase: string; message: string }) => event.phase === "image-input" && event.message.includes("verify")));
      if (name === "Peter") for (const action of ["next-pass", "step", "pause", "answer"]) {
        const denied = await context.request.post(`${origin}/api/knowledge/jobs/${job.id}/${action}?brain=${brainId}`, { headers: { Origin: origin }, data: {} });
        assert.equal(denied.status(), 403, "Member access must not start paid work or change checkpoints.");
      }
      const search = await (await context.request.get(`${origin}/api/knowledge/nodes?brain=${brainId}&q=PHSR`)).json();
      const teaching = search.nodes.find((node: { type: string }) => node.type === "teaching");
      assert.ok(teaching);
      const detail = await (await context.request.get(`${origin}/api/knowledge/node?brain=${brainId}&id=${encodeURIComponent(teaching.id)}`)).json();
      const evidence = detail.node.evidence[0];
      const passage = await (await context.request.get(`${origin}/api/passage?brain=${brainId}&id=${encodeURIComponent(evidence.passageId)}`)).json();
      assert.ok(passage.text.includes(evidence.quote));
      assert.equal(passage.sourceId, sourceId);
      const photoNode = workspace.nodes.find((node: { evidence?: { imageId?: string }[] }) => node.evidence?.some(item => item.imageId));
      assert.ok(photoNode, "Verified image-backed teachings must appear in the live graph.");
      const photoDetail = await (await context.request.get(`${origin}/api/knowledge/node?brain=${brainId}&id=${encodeURIComponent(photoNode.id)}`)).json();
      const visual = photoDetail.node.evidence.find((item: { imageId?: string }) => item.imageId);
      assert.ok(visual.visualObservation.length >= 20);
      const originalPassage = await (await context.request.get(`${origin}/api/passage?brain=${brainId}&id=${encodeURIComponent(visual.passageId)}`)).json();
      const image = await context.request.get(`${origin}/api/source-image?brain=${brainId}&passage=${encodeURIComponent(visual.passageId)}`);
      assert.equal(image.status(), 200);
      assert.equal(createHash("sha256").update(await image.body()).digest("hex"), originalPassage.image.sha256);
      assert.equal((await context.request.get(`${origin}/api/source-image?brain=main&passage=${encodeURIComponent(visual.passageId)}`)).status(), 404, "Images cannot cross brain boundaries.");
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/?brain=${brainId}`);
      const spendingBar = page.getByRole("region", { name: "Model spending" });
      await expect(spendingBar).toContainText(`$${job.costUsd.toFixed(4)}`);
      await spendingBar.getByRole("button", { name: "Refresh spending" }).click();
      await expect(spendingBar.getByRole("button", { name: "Refresh spending" })).toBeEnabled();
      await page.getByRole("button", { name: "Knowledge extraction", exact: true }).click();
      await expect(page.locator(".knowledge-extraction")).toContainText(String(job.nodesAdded));
      await expect(page.locator(".knowledge-extraction")).toContainText("1,028 original images connected");
      await expect(page.getByRole("heading", { name: "Full-book pass 1 of 3" })).toBeVisible();
      await page.getByText("Activity, evidence decisions & questions", { exact: true }).click();
      await expect(page.getByRole("heading", { name: "Recent passage decisions" })).toBeVisible();
      if (name === "Peter") assert.equal(await page.locator(".knowledge-extraction").getByRole("button", { name: /Start paid|Resume|Pause|Continue here/ }).count(), 0);
      if (name === "Alex") {
        const original = await context.request.get(`${origin}/api/original?brain=${brainId}&id=${sourceId}`);
        assert.equal(original.status(), 200);
        const bytes = await original.body();
        assert.equal(createHash("sha256").update(bytes).digest("hex"), "a821e6e585aa027d1d2a1a6dc0b6814a1169ebc6d8d75e1212e91dff72737a69");
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ account: name, live: true, sources: workspace.sources.length, teachingNodes: workspace.stats.teachings, connectedImages: job.imagePassages, reviewedImages: job.reviewedImages, trackedCostUsd: job.costUsd, measuredCostUsd: job.measuredCostUsd, mainSourcesUnchanged: main.sources.length, exactEvidence: true, imageFingerprintVerified: true, originalVerified: name === "Alex", paidCalls: 0 }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live verification failed"); process.exitCode = 1; });
