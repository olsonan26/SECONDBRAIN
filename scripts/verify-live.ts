import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const url = process.argv[2];
const cli = process.argv[3];
if (!url || !cli || !url.startsWith("https://")) throw new Error("Usage: verify-live.ts https://deployment.vercel.app /absolute/path/to/vercel/dist/index.js");
const origin = new URL(url).origin;
const access = readFileSync("ACCESS-PRIVATE.txt", "utf8");
const quote = (value: string) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
function request(path: string, method = "GET", data?: unknown, cookie?: string) {
  const config = ["silent", "show-error", "include", `request = ${quote(method)}`, `header = ${quote(`Origin: ${origin}`)}`];
  if (data !== undefined) config.push(`header = ${quote("Content-Type: application/json")}`, `data = ${quote(JSON.stringify(data))}`);
  if (cookie) config.push(`header = ${quote(`Cookie: ${cookie}`)}`);
  const result = spawnSync(process.execPath, [cli, "curl", path, "--deployment", origin, "--scope", "alex-olsons-projects-43241a84", "--", "--config", "-"], { input: config.join("\n") + "\n", encoding: "utf8", timeout: 90_000, maxBuffer: 8_000_000, windowsHide: true });
  if (result.status !== 0) throw new Error(`Live request failed: ${path}. CLI exit ${result.status}.`);
  let output = result.stdout;
  let parsed: RegExpMatchArray | null = null;
  do { parsed = output.match(/^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)/); if (!parsed) throw new Error(`Live request returned unreadable headers: ${path}`); output = parsed[3]; } while (/^HTTP\//.test(output));
  let body: any = output; try { body = JSON.parse(output); } catch {}
  const sessionCookie = parsed[2].match(/^set-cookie:\s*(secondbrain_session=[^;\r\n]+)/im)?.[1];
  return { status: Number(parsed[1]), body, cookie: sessionCookie };
}
function login(name: string) {
  const match = access.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  if (!match) throw new Error("Missing private test account.");
  const response = request("/api/auth/login", "POST", { username: match[1], password: match[2] });
  assert.equal(response.status, 200, `${name} sign-in failed with HTTP ${response.status}`);
  assert.ok(response.cookie, "Sign-in did not create a session");
  return response.cookie;
}
assert.equal(request("/api/workspace").status, 401);
console.log("PASS: unauthenticated library access is blocked.");
const alex = login("Alex");
console.log("PASS: Alex can sign in.");
const workspace = request("/api/workspace", "GET", undefined, alex);
assert.equal(workspace.status, 200); assert.equal(workspace.body.persistence, "cloud");
assert.equal(workspace.body.stats.sources, 74); assert.equal(workspace.body.stats.passages, 2348); assert.equal(workspace.body.stats.nodes, 565);
assert.ok(workspace.body.sources.every((s: Record<string, unknown>) => !("content" in s)));
assert.ok(!("apiKey" in workspace.body.settings));
console.log("PASS: all 74 sources, 2,348 passages, and 565 graph nodes load from private cloud storage.");
const answer = request("/api/ask", "POST", { question: "What is a personal year?" }, alex);
assert.equal(answer.status, 200); assert.ok(answer.body.citations.length > 0);
const citation = answer.body.citations[0];
const passage = request(`/api/passage?id=${encodeURIComponent(citation.id)}`, "GET", undefined, alex);
const source = request(`/api/source?id=${encodeURIComponent(citation.sourceId)}`, "GET", undefined, alex);
assert.equal(passage.body.text, citation.text); assert.ok(source.body.content.includes(citation.text));
console.log("PASS: a live question retrieves exact, source-resolving citations.");
const peter = login("Peter");
const shared = request("/api/workspace", "GET", undefined, peter);
assert.equal(shared.status, 200); assert.equal(shared.body.user.role, "member"); assert.equal(shared.body.stats.sources, 74);
assert.equal(request("/api/settings", "POST", { model: "deepseek-chat", writingInstructions: "" }, peter).status, 403);
console.log("PASS: Peter can access the shared library but cannot change owner settings.");
const run = request("/api/workflows", "POST", { kind: "knowledge-audit", question: "Publishing verification" }, alex);
assert.equal(run.status, 200);
const reread = request("/api/workspace", "GET", undefined, peter);
assert.ok(reread.body.runs.some((r: {id:string}) => r.id === run.body.id));
console.log("PASS: workflow results persist in cloud storage and are shared between accounts.");
assert.equal(request("/api/auth/logout", "POST", {}, alex).status, 200);
console.log("Live publication verification complete. Model generation requires a configured API key.");
