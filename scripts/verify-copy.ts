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
      await expect(page.getByRole("status")).toContainText("Article copied to clipboard.");
      assert.ok(await readClipboard() === original, "Copied article content does not match the editor");
      const edited = original + "\n\nUnsaved clipboard verification edit.";
      await editor.fill(edited);
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      await expect.poll(async () => await readClipboard() === edited).toBe(true);
      await editor.fill("");
      await expect(page.getByRole("button", { name: "Copy article", exact: true })).toBeDisabled();
      await editor.fill(original);
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      await expect.poll(async () => await readClipboard() === original).toBe(true);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Copy article", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Copy article", exact: true })).toBeVisible();
      await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException("Blocked", "NotAllowedError"); }; });
      await page.getByRole("button", { name: "Copy article", exact: true }).click();
      await expect(page.locator(".error-banner[role=alert]")).toContainText("Clipboard access was blocked.");
      console.log(`PASS: ${name} can copy saved and unsaved article text, including from preview and on mobile. Empty articles disable copying; denied permission shows a helpful error. No edits saved.`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Copy verification failed"); process.exitCode = 1; });
