import { chromium, expect, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import type { Answer, Source, Workspace } from "../src/lib/types";

async function main() {
const origin = process.argv[2];
const option = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const file = option("--file");
assert.ok(origin && process.argv.includes("--file") && file, "Usage: verify-pdf-upload.ts URL --file PDF --brain ID [--question QUESTION] [--create-test-brain]");
const local = ["127.0.0.1", "localhost"].includes(new URL(origin).hostname);
const createTestBrain = process.argv.includes("--create-test-brain");
assert.ok(!createTestBrain || local, "Test brains may only be created on localhost.");
assert.ok(createTestBrain || process.argv.includes("--brain"), "Choose an explicit destination brain.");
const bytes = readFileSync(file);
const parsed = await extractText(new Uint8Array(bytes), { mergePages: false });
const fullText = parsed.text.map((text, i) => `## Page ${i + 1}\n\n${text}`).join("\n\n");
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
function credentials(name: string) {
  const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  assert.ok(match, "Private test account missing");
  return { username: match[1], password: match[2] };
}
async function getWorkspace(context: BrowserContext, brain = "main"): Promise<Workspace> {
  const r = await context.request.get(`${origin}/api/workspace?brain=${brain}`);
  assert.equal(r.status(), 200); return r.json();
}
const signature = (w: Workspace) => hash(JSON.stringify({ sources: w.sources, stats: w.stats, drafts: w.drafts, runs: w.runs, nodes: w.nodes, edges: w.edges, settings: w.settings }));
const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
try {
  const alex = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  assert.equal((await alex.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: credentials("Alex") })).status(), 200);
  const mainBefore = signature(await getWorkspace(alex));
  let id = option("--brain");
  if (createTestBrain) {
    const r = await alex.request.post(`${origin}/api/brains`, { headers: { Origin: origin }, data: { name: `PDF verification ${Date.now()}`, description: "Local-only upload regression test." } });
    assert.equal(r.status(), 201); id = (await r.json()).id;
  }
  assert.notEqual(id, "main", "This verification preserves the user's main library.");
  const before = await getWorkspace(alex, id);
  const existing = before.sources.find(s => s.sha256 === hash(fullText));
  const page = await alex.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(`${origin}/?brain=${id}`);
  await expect(page.getByLabel("Active brain", { exact: true })).toHaveValue(id);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/import", { timeout: 120_000 });
  await page.locator('input[type="file"]').setInputFiles(file);
  const imported = await response;
  assert.equal(new URL(imported.url()).searchParams.get("brain"), id);
  const result = await imported.json();
  assert.equal(imported.status(), existing ? 409 : 200, result.error);
  const source: Source = existing ?? result.source;
  if (!existing) {
    await expect(page.locator(".import-feedback.success")).toContainText("Import complete");
    await expect(page.locator(".import-feedback.success")).toContainText(`${parsed.totalPages} pages`);
    await expect(page.locator(".source-row").filter({ hasText: basename(file) })).toBeVisible();
    console.log(`PASS: browser upload saved ${source.pages} pages and ${result.passages} searchable passages; persistent success feedback and library row visible.`);
    await page.screenshot({ path: "test-results/pdf-upload-success.png", fullPage: true });
  }
  await page.reload();
  const stored = await alex.request.get(`${origin}/api/source?brain=${id}&id=${source.id}`);
  assert.equal(stored.status(), 200);
  const saved: Source = await stored.json();
  assert.equal(saved.content, fullText, "Every extracted page must be saved without truncation");
  assert.equal(saved.pages, parsed.totalPages);
  const original = await alex.request.get(`${origin}/api/original?brain=${id}&id=${source.id}`);
  assert.equal(original.status(), 200); assert.equal(hash(await original.body()), hash(bytes));
  assert.equal((await alex.request.get(`${origin}/api/source?brain=main&id=${source.id}`)).status(), 404);
  assert.equal(signature(await getWorkspace(alex)), mainBefore, "The main library was changed");
  console.log("PASS: full extracted text and byte-identical original survive reload; main brain and shared settings unchanged.");

  let importRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/import") importRequests++; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('input[type="file"]').setInputFiles({ name: "Too large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(4_000_001) });
  await expect(page.locator(".import-feedback.error")).toContainText("over 4 MB");
  const bounds = await page.locator(".import-feedback.error").boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
  assert.equal(importRequests, 0, "Oversize files should be rejected before sending");
  await page.screenshot({ path: "test-results/pdf-upload-error-mobile.png", fullPage: true });
  const duplicate = page.waitForResponse(r => new URL(r.url()).pathname === "/api/import", { timeout: 120_000 });
  await page.locator('input[type="file"]').setInputFiles(file);
  assert.equal((await duplicate).status(), 409);
  await expect(page.locator(".import-feedback.error")).toContainText("already in your library");
  assert.equal((await getWorkspace(alex, id)).sources.length, before.sources.length + (existing ? 0 : 1));
  console.log("PASS: mobile errors stay visible; oversize preflight and repeat-file protection work.");

  if (process.argv.includes("--question")) {
    await page.getByRole("button", { name: "Ask your knowledge", exact: true }).click();
    await page.getByLabel("Your question", { exact: true }).fill(option("--question"));
    const answerResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/ask", { timeout: 120_000 });
    await page.getByRole("button", { name: "Ask the brain", exact: true }).click();
    const response = await answerResponse; assert.equal(response.status(), 200);
    const answer: Answer = await response.json();
    assert.notEqual(answer.mode, "not-found"); assert.ok(answer.citations.length);
    assert.ok(answer.citations.every(c => c.sourceId === source.id && c.page && fullText.includes(c.text)));
    await expect(page.locator(".answer-card .citation-card").first()).toBeVisible();
    console.log(`PASS: real question returns ${answer.mode} answer with ${answer.citations.length} exact page-linked passages from the uploaded PDF.`);
    await page.screenshot({ path: "test-results/pdf-question.png", fullPage: true });
  }
  const peter = await browser.newContext();
  assert.equal((await peter.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: credentials("Peter") })).status(), 200);
  assert.ok((await getWorkspace(peter, id)).sources.some(s => s.id === source.id));
  assert.equal((await peter.request.get(`${origin}/api/source?brain=${id}&id=${source.id}`)).status(), 200);
  assert.equal((await peter.request.post(`${origin}/api/import?brain=${id}`, { headers: { Origin: origin }, multipart: { file: { name: "denied.txt", mimeType: "text/plain", buffer: Buffer.from("This member must not be allowed to modify the library.") } } })).status(), 403);
  assert.deepEqual(browserErrors, []);
  console.log("PASS: Peter can read the shared PDF; owner-only import permissions remain intact; no browser errors.");
} finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
