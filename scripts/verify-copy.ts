import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

async function main() {
  const origin = process.argv[2] || "http://127.0.0.1:3101";
  const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" });
  try {
    for (const name of ["Alex", "Peter"]) {
      const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
      assert.ok(match, "Missing private verification account");
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
      const login = await context.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { username: match[1], password: match[2] } });
      assert.equal(login.status(), 200);
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole("button", { name: "Writing studio", exact: true }).click();
      const editor = page.getByLabel("Article draft", { exact: true });
      await expect(editor).toBeVisible();
      const original = await editor.inputValue();
      const readClipboard = () => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"));
      assert.ok(original.trim(), "A saved article is required for this read-only copy check");
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Article copied with formatting.");
      assert.ok((await readClipboard()).length > 0, "Copied article is empty");
      const edited = "# A beautifully formatted ARTICLE\n\nThis has **BOLD WORDING** and carefully spaced paragraphs.\n\n## A clear section\n\nAnother paragraph, with *gentle emphasis*.\n\n- First point\n- Second point\n\n> A thoughtful quotation.\n\n<script>window.clipboardUnsafe=true</script>";
      await editor.fill(edited);
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      await expect.poll(async () => (await readClipboard()).includes("BOLD WORDING")).toBe(true);
      const rich = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items.find(item => item.types.includes("text/html"));
        if (!item) return { rich: false };
        const document = new DOMParser().parseFromString(await (await item.getType("text/html")).text(), "text/html");
        return { rich: true, heading: document.querySelector("h1")?.textContent, bold: document.querySelector("strong")?.textContent,
          section: document.querySelector("h2")?.textContent, paragraphs: document.querySelectorAll("p").length,
          paragraphSpacing: document.querySelector("p")?.style.marginBottom, lineHeight: document.querySelector("article")?.style.lineHeight,
          listItems: document.querySelectorAll("li").length, quote: Boolean(document.querySelector("blockquote")), scripts: document.querySelectorAll("script").length };
      });
      assert.equal(rich.rich, true);
      assert.equal(rich.heading, "A beautifully formatted ARTICLE");
      assert.equal(rich.bold, "BOLD WORDING");
      assert.equal(rich.section, "A clear section");
      assert.ok(Number(rich.paragraphs) >= 2);
      assert.ok(rich.paragraphSpacing);
      assert.equal(rich.lineHeight, "1.75");
      assert.equal(rich.listItems, 2);
      assert.equal(rich.quote, true);
      assert.equal(rich.scripts, 0);
      assert.ok(!(await readClipboard()).includes("**"), "Plain-text fallback should not contain Markdown emphasis markers");
      await editor.fill("");
      await expect(page.getByRole("button", { name: "Copy article", exact: true })).toBeDisabled();
      await editor.fill(original);
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      const previewText = (await page.locator(".draft-preview .article-prose").innerText()).replace(/\r\n/g, "\n").trim();
      await expect.poll(async () => await readClipboard() === previewText).toBe(true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Copy article", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Copy article", exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/article-preview-${name.toLowerCase()}.png`, fullPage: true });
      await page.evaluate(() => { navigator.clipboard.write = async () => { throw new DOMException("Blocked", "NotAllowedError"); }; });
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      await expect(page.locator(".error-banner[role=alert]")).toContainText("Clipboard access was blocked.");
      console.log(`PASS: ${name} can copy styled articles with bold, capitalization, headings, paragraph spacing, lists and quotes; preview/mobile and blocked-permission checks passed. No edits saved.`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Copy verification failed"); process.exitCode = 1; });
