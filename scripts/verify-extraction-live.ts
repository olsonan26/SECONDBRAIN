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
  try {
    for (const name of ["Alex", "Peter"]) {
      const credentials = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
      assert.ok(credentials);
      const context = await browser.newContext();
      const login = await context.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { username: credentials[1], password: credentials[2] } });
      assert.equal(login.status(), 200);
      const workspace = await (await context.request.get(`${origin}/api/workspace?brain=${brainId}`)).json();
      assert.equal(workspace.brain.name, "Astrology");
      assert.equal(workspace.sources.length, 2);
      const main = await (await context.request.get(`${origin}/api/workspace?brain=main`)).json();
      assert.equal(main.sources.length, 74, "Main brain source count must remain unchanged.");
      const jobs = await (await context.request.get(`${origin}/api/knowledge/jobs?brain=${brainId}`)).json();
      const job = jobs.jobs.find((job: { id: string }) => job.id === "03478f99-4e19-4fa9-a376-899ec53f657c");
      assert.ok(job && job.nodesAdded >= 23 && job.budgetUsd === 10);
      const search = await (await context.request.get(`${origin}/api/knowledge/nodes?brain=${brainId}&q=PHSR`)).json();
      const teaching = search.nodes.find((node: { type: string }) => node.type === "teaching");
      assert.ok(teaching);
      const detail = await (await context.request.get(`${origin}/api/knowledge/node?brain=${brainId}&id=${encodeURIComponent(teaching.id)}`)).json();
      const evidence = detail.node.evidence[0];
      const passage = await (await context.request.get(`${origin}/api/passage?brain=${brainId}&id=${encodeURIComponent(evidence.passageId)}`)).json();
      assert.ok(passage.text.includes(evidence.quote));
      assert.equal(passage.sourceId, sourceId);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/?brain=${brainId}`);
      await page.getByRole("button", { name: "Knowledge extraction", exact: true }).click();
      await expect(page.locator(".knowledge-extraction")).toContainText("23");
      if (name === "Peter") assert.equal(await page.locator(".knowledge-extraction").getByRole("button", { name: /Start paid|Resume|Pause|Continue here/ }).count(), 0);
      if (name === "Alex") {
        const original = await context.request.get(`${origin}/api/original?brain=${brainId}&id=${sourceId}`);
        assert.equal(original.status(), 200);
        const bytes = await original.body();
        assert.equal(createHash("sha256").update(bytes).digest("hex"), "a821e6e585aa027d1d2a1a6dc0b6814a1169ebc6d8d75e1212e91dff72737a69");
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ account: name, live: true, sources: workspace.sources.length, pilotNodes: job.nodesAdded, measuredCostUsd: job.measuredCostUsd, mainSourcesUnchanged: main.sources.length, exactEvidence: true, originalVerified: name === "Alex", paidCalls: 0 }));
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live verification failed"); process.exitCode = 1; });
