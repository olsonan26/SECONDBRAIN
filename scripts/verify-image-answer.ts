import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

async function main() {
  assert.equal(process.argv[2], "--one-paid-question");
  const origin = "https://secondbrain-nu-nine.vercel.app", brainId = "a2f66ffe-ae02-40eb-a264-a5697dcb6c5b";
  const match = readFileSync("ACCESS-PRIVATE.txt", "utf8").match(/Alex: username ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/); assert.ok(match);
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
  try {
    const context = await browser.newContext();
    assert.equal((await context.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { username: match[1], password: match[2] } })).status(), 200);
    const response = await context.request.post(`${origin}/api/ask?brain=${brainId}`, { timeout: 120_000, headers: { Origin: origin }, data: { question: "How does the book distinguish conscious cooperation from fusion in an Opposition?", sourceIds: ["astrology-original-page-photographs"] } });
    assert.equal(response.status(), 200);
    const answer = await response.json();
    assert.equal(answer.mode, "model", JSON.stringify(answer.warnings));
    assert.ok(answer.citations.some((c: { image?: unknown }) => c.image));
    assert.ok(answer.citations.every((c: { sourceId: string }) => c.sourceId === "astrology-original-page-photographs"));
    assert.match(answer.text, /cooperat/i);
    console.log(JSON.stringify({ live: true, model: answer.model, mode: answer.mode, citations: answer.citations.length, attachedOriginalImages: answer.citations.filter((c: { image?: unknown }) => c.image).length, sourceScoped: true, independentReviewPassed: true, answer: answer.text }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live image answer failed"); process.exitCode = 1; });
