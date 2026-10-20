import { chromium, expect, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { Brain, Workspace } from "../src/lib/types";

const origin = process.argv[2] || "http://127.0.0.1:3101";
const fixtures = process.argv.includes("--local-fixtures");
if (fixtures && !["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Synthetic fixture imports are allowed only on a local test server.");
const prepare = process.argv.includes("--prepare-astrology");
const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
function credentials(name: string) {
  const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  assert.ok(match, "Private test account missing");
  return { username: match[1], password: match[2] };
}
async function workspace(context: BrowserContext, id = "main"): Promise<Workspace> {
  const response = await context.request.get(`${origin}/api/workspace?brain=${id}`);
  assert.equal(response.status(), 200);
  return response.json();
}
const signature = (w: Workspace) => JSON.stringify({ sources: w.sources.map(s => [s.id, s.sha256]), stats: w.stats, drafts: w.drafts.map(d => [d.id, d.revision]), runs: w.runs.map(r => r.id), settings: w.settings });

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
  try {
    const alex = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    assert.equal((await alex.request.get(`${origin}/api/brains`)).status(), 401);
    assert.equal((await alex.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: credentials("Alex") })).status(), 200);
    const before = await workspace(alex);
    assert.equal(before.brain.id, "main");
    const page = await alex.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByLabel("Active brain", { exact: true })).toHaveValue("main");
    const name = fixtures ? `Astrology fixture ${Date.now()}` : "Astrology";
    let brain = before.brains.find(b => b.name.toLowerCase() === name.toLowerCase());
    if (!brain) {
      assert.ok(fixtures || prepare, "Use --prepare-astrology to create the user's requested empty brain.");
      await page.getByRole("button", { name: "Create a brain", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByLabel("Brain name", { exact: true }).fill(name);
      await page.getByLabel(/What belongs here/).fill(fixtures ? "Local browser verification fixture only." : "Astrology knowledge only: planets, signs, houses, aspects, and chart interpretations.");
      const createdResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/brains" && r.request().method() === "POST");
      await page.getByRole("button", { name: "Create brain", exact: true }).click();
      const created = await createdResponse;
      assert.equal(created.status(), 201);
      await page.waitForURL(url => Boolean(url.searchParams.get("brain")) && url.searchParams.get("brain") !== "main");
      const createdId = new URL(page.url()).searchParams.get("brain")!;
      brain = (await workspace(alex, createdId)).brain;
      assert.equal(brain.name, name);
      console.log("PASS: a separate brain can be created through the real browser dialog.");
    } else {
      await page.getByLabel("Active brain", { exact: true }).selectOption(brain.id);
      await page.waitForURL(url => url.searchParams.get("brain") === brain!.id);
    }
    const id = brain.id;
    const api = (route: string) => `${origin}/api/${route}${route.includes("?") ? "&" : "?"}brain=${id}`;
    await expect(page.getByLabel("Active brain", { exact: true })).toHaveValue(id);
    await expect(page.locator(".breadcrumb")).toContainText(brain.name);
    const empty = await workspace(alex, id);
    assert.equal(empty.sources.length, 0, "New astrology brain must not inherit the main library");
    assert.equal(empty.nodes.length, 0); assert.equal(empty.edges.length, 0);
    assert.equal(empty.drafts.length, 0); assert.equal(empty.runs.length, 0);
    assert.deepEqual(empty.settings, before.settings, "Shared model/writing settings changed");
    await expect(page.locator(".brain-empty-welcome")).toBeVisible();
    if (before.sources[0]) assert.equal((await alex.request.get(api(`source?id=${before.sources[0].id}`))).status(), 404);
    const passage = before.drafts.flatMap(d => d.citations)[0];
    if (passage) assert.equal((await alex.request.get(api(`passage?id=${passage.id}`))).status(), 404);
    const otherDraft = before.drafts[0];
    if (otherDraft) {
      const wrongSave = await alex.request.patch(api("drafts"), { headers: { Origin: origin }, data: { id: otherDraft.id, title: otherDraft.title, text: otherDraft.text, status: otherDraft.status, revision: otherDraft.revision } });
      assert.equal(wrongSave.status(), 404);
    }
    const missing = "a96ac723-d66d-4c24-a1da-a1d64d789eb5";
    assert.equal((await alex.request.get(`${origin}/api/workspace?brain=${missing}`)).status(), 404);
    assert.equal((await alex.request.get(`${origin}/api/workspace?brain=..%2Fmain`)).status(), 400);
    assert.equal((await alex.request.get(`${origin}/api/workspace?brain=${id}&brain=main`)).status(), 400);
    const question = await alex.request.post(api("ask"), { headers: { Origin: origin }, data: { question: "personal year" } });
    assert.equal((await question.json()).mode, "not-found");
    const draftAttempt = await alex.request.post(api("drafts"), { headers: { Origin: origin }, data: { brief: "personal year" } });
    assert.equal(draftAttempt.status(), 422);
    console.log("PASS: empty brain never falls back to main sources, passages, drafts, or model context; invalid brain IDs fail closed.");

    if (fixtures) {
      const content = "Zodiac signs and astrology are symbolic interpretations of planetary themes. Zodiac signs organize these astrology notes for an isolated browser verification fixture.";
      const uploadedResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/import");
      await page.locator('input[type="file"]').setInputFiles({ name: "Astrology fixture.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
      const uploaded = await uploadedResponse;
      assert.equal(new URL(uploaded.url()).searchParams.get("brain"), id);
      assert.equal(uploaded.status(), 200);
      const source = (await uploaded.json()).source;
      await expect(page.locator(".import-feedback.success")).toContainText(`Saved in ${name}`);
      const populated = await workspace(alex, id);
      assert.equal(populated.sources.length, 1); assert.equal(populated.nodes.length, 1);
      assert.equal((await alex.request.get(`${origin}/api/source?id=${source.id}&brain=main`)).status(), 404);
      const original = await alex.request.get(api(`original?id=${source.id}`));
      assert.equal(original.status(), 200); assert.equal(await original.text(), content);
      assert.equal((await alex.request.get(`${origin}/api/original?id=${source.id}&brain=main`)).status(), 404);
      await page.getByRole("button", { name: "Ask your knowledge", exact: true }).click();
      await page.getByLabel("Your question", { exact: true }).fill("zodiac signs");
      const answered = page.waitForResponse(r => new URL(r.url()).pathname === "/api/ask");
      await page.getByRole("button", { name: "Ask the brain", exact: true }).click();
      const answer = await (await answered).json();
      assert.equal(answer.mode, "extractive"); assert.ok(answer.citations.every((c: { sourceId: string }) => c.sourceId === source.id));
      const draftResponse = await alex.request.post(api("drafts"), { headers: { Origin: origin }, data: { brief: "zodiac signs", title: "Isolated astrology outline" } });
      assert.equal(draftResponse.status(), 200);
      await alex.request.post(api("workflows"), { headers: { Origin: origin }, data: { kind: "knowledge-audit" } });
      assert.equal((await workspace(alex, id)).drafts.length, 1);
      await page.reload();
      await page.getByRole("button", { name: "Writing studio", exact: true }).click();
      await page.getByRole("button", { name: "Edit article", exact: true }).click();
      await page.getByLabel("Article draft", { exact: true }).fill("Unsaved test edit in the astrology brain.");
      page.once("dialog", dialog => dialog.dismiss());
      await page.getByLabel("Active brain", { exact: true }).selectOption("main");
      await expect(page.getByLabel("Active brain", { exact: true })).toHaveValue(id);
      page.once("dialog", dialog => dialog.accept());
      await page.getByLabel("Active brain", { exact: true }).selectOption("main");
      await page.waitForURL(url => url.searchParams.get("brain") === "main");
      await page.getByRole("button", { name: "Ask your knowledge", exact: true }).click();
      await expect(page.locator(".answer-card")).toHaveCount(0);
      await page.getByLabel("Active brain", { exact: true }).selectOption(id);
      await page.waitForURL(url => url.searchParams.get("brain") === id);
      console.log("PASS: browser uploads, original downloads, questions, articles, and workflow history stay scoped; switching protects unsaved edits and resets old answers.");
    }
    assert.equal(signature(await workspace(alex)), signature(before), "Main brain content or shared settings changed");
    await page.screenshot({ path: "test-results/brains-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Active brain", { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.getByRole("button", { name: "Create a brain", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.screenshot({ path: "test-results/brains-mobile.png", fullPage: true });

    const peter = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const memberPage = await peter.newPage();
    await memberPage.goto(`${origin}/?brain=${id}`);
    const account = credentials("Peter");
    await memberPage.getByLabel("Username", { exact: true }).fill(account.username);
    await memberPage.getByLabel("Password", { exact: true }).fill(account.password);
    await memberPage.getByRole("button", { name: "Enter your workspace" }).click();
    await expect(memberPage.getByLabel("Active brain", { exact: true })).toHaveValue(id);
    assert.equal(new URL(memberPage.url()).searchParams.get("brain"), id);
    await expect(memberPage.getByRole("button", { name: "Create a brain", exact: true })).toHaveCount(0);
    assert.equal((await peter.request.post(`${origin}/api/brains`, { headers: { Origin: origin }, data: { name: "Should not be created" } })).status(), 403);
    assert.equal((await peter.request.post(api("import"), { headers: { Origin: origin }, data: {} })).status(), 403);
    assert.equal((await workspace(peter, id)).brain.id, id);
    assert.equal(signature(await workspace(alex)), signature(before));
    assert.deepEqual(errors, []);
    console.log("PASS: Peter can open and switch shared brains, deep-link sign-in preserves the chosen brain, owner-only creation/import is enforced, and mobile controls fit.");
    console.log(JSON.stringify({ astrologyBrainId: id, mainSourcesPreserved: before.sources.length, productionAstrologySources: fixtures ? "local fixtures only" : 0 }));
    await peter.close(); await alex.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Brain verification failed"); process.exitCode = 1; });
