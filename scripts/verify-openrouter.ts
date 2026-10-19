import { chromium, expect, type BrowserContext } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { OPENROUTER_MODEL } from "../src/lib/model-provider";

const origin = process.argv[2] || "http://127.0.0.1:3101";
const activate = process.argv.includes("--activate-openrouter");
const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
function credentials(name: string) {
  const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  if (!match) throw new Error("Private verification account missing");
  return { username: match[1], password: match[2] };
}
async function workspace(context: BrowserContext) {
  const response = await context.request.get(`${origin}/api/workspace`);
  assert.equal(response.status(), 200);
  return response.json();
}
async function main() {
  const executablePath = "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
  const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  try {
    const alex = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await alex.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    const account = credentials("Alex");
    await page.getByLabel("Username", { exact: true }).fill(account.username);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Enter your workspace" }).click();
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    const before = (await workspace(alex)).settings;
    await page.locator(".workspace-switch").click();
    await expect(page.getByLabel("API provider", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Writing guidance", { exact: true })).toHaveValue(before.writingInstructions);
    await page.getByLabel("API provider", { exact: true }).selectOption("openrouter");
    // Selecting an unchanged option does not dispatch onChange.
    await page.getByLabel("Model name", { exact: true }).fill(OPENROUTER_MODEL);
    await expect(page.getByLabel("OpenRouter API key", { exact: true })).toBeVisible();
    console.log("PASS: owner provider selector, model field, and saved writing guidance render correctly.");
    if (activate) {
      const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Save settings", exact: true }).click();
      assert.equal((await saved).status(), 200, "Provider settings could not be saved");
      const after = (await workspace(alex)).settings;
      assert.equal(after.provider, "openrouter");
      assert.equal(after.model, OPENROUTER_MODEL);
      assert.equal(after.writingInstructions, before.writingInstructions);
      assert.equal(after.connected, true);
      assert.ok(!("apiKey" in after));
      console.log("PASS: shared OpenRouter settings persisted without replacing the key or writing rules.");
      await page.getByRole("button", { name: "Ask your knowledge", exact: true }).click();
      await page.getByLabel("Your question", { exact: true }).fill("What do the sources say about personal year 7 and reflection? Give a short answer and attribute the ideas to the sources.");
      const answerResponse = page.waitForResponse(r => r.url().endsWith("/api/ask"), { timeout: 125_000 });
      await page.getByRole("button", { name: "Ask the brain", exact: true }).click();
      const answer = await (await answerResponse).json();
      assert.equal(answer.mode, "model", `AI answer did not complete: ${JSON.stringify(answer.warnings)}`);
      assert.equal(answer.model, OPENROUTER_MODEL);
      assert.ok(answer.citations.length > 0);
      await expect(page.getByText("Source-grounded answer", { exact: true })).toBeVisible();
      await page.locator(".answer-card .citation-card").first().click();
      await expect(page.locator(".inspector-body")).toContainText(answer.citations[0].text.slice(0, 70));
      console.log(`PASS: live OpenRouter answer passed citation and evidence review; ${answer.citations.length} citations open in the browser.`);
      await page.getByRole("button", { name: "Writing studio", exact: true }).click();
      await page.getByLabel("What are we writing?", { exact: true }).fill("Write a short 120-word article for newcomers about personal year 7, reflection and study. Present these as the sources' numerology interpretations, not proven facts. Start with an engaging truthful hook. No invented examples or promises.");
      const draftResponse = page.waitForResponse(r => r.url().endsWith("/api/drafts") && r.request().method() === "POST", { timeout: 125_000 });
      await page.getByRole("button", { name: "Create source-based draft", exact: true }).click();
      const draftHttp = await draftResponse;
      const draft = await draftHttp.json();
      assert.equal(draftHttp.status(), 200, `Draft failed: ${JSON.stringify(draft)}`);
      assert.equal(draft.mode, "model");
      await expect(page.getByLabel("Article draft", { exact: true })).toHaveValue(draft.text);
      console.log(`PASS: live article generation passed evidence review and persisted with ${draft.citations.length} citations.`);
    }
    const peter = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const signIn = await peter.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: credentials("Peter") });
    assert.equal(signIn.status(), 200);
    const shared = await workspace(peter);
    if (activate) {
      assert.equal(shared.settings.provider, "openrouter");
      assert.equal(shared.settings.model, OPENROUTER_MODEL);
      assert.equal(shared.settings.writingInstructions, before.writingInstructions);
      const attempt = await peter.request.post(`${origin}/api/settings`, { headers: { Origin: origin }, data: { provider: "openrouter", model: OPENROUTER_MODEL, writingInstructions: "test" } });
      assert.equal(attempt.status(), 403);
    }
    const memberPage = await peter.newPage();
    await memberPage.goto(origin);
    await memberPage.locator(".workspace-switch").click();
    await expect(memberPage.getByLabel("API provider", { exact: true })).toBeDisabled();
    console.log("PASS: Peter sees the shared settings but cannot change the provider.");
    assert.deepEqual(errors, []);
    await peter.close();
    await alex.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
