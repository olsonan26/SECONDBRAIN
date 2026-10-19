import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const existing = "C:/Users/olson/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
export default defineConfig({ testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 60_000,
  use: { baseURL: process.env.BRAIN_TEST_URL || "http://127.0.0.1:3000", headless: true,
    launchOptions: { ...(existsSync(existing) ? { executablePath: existing } : {}) }, screenshot: "only-on-failure" },
  reporter: "list" });
