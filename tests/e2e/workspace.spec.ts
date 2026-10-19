import { test, expect, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";

function credentials(name: "Alex" | "Peter") {
  const text = readFileSync("ACCESS-PRIVATE.txt", "utf8");
  const match = text.match(new RegExp(`${name}: username ([^\\r\\n]+)\\r?\\nPassword: ([^\\r\\n]+)`));
  if (!match) throw new Error("Private test credentials are missing");
  return { username: match[1], password: match[2] };
}
const origin = process.env.BRAIN_TEST_URL || "http://127.0.0.1:3000";
async function login(context: BrowserContext, name: "Alex" | "Peter") {
  const response = await context.request.post("/api/auth/login", { data: credentials(name), headers: { Origin: origin } });
  expect(response.status()).toBe(200);
}

test("private library is inaccessible before sign-in", async ({ page, request }) => {
  const response = await request.get("/api/workspace"); expect(response.status()).toBe(401);
  const source = await request.get("/api/source?id=anything"); expect(source.status()).toBe(401);
  const direct = await request.get("/private/corpus.json"); expect(direct.status()).toBe(404);
  await page.goto("/"); await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  expect(await page.content()).not.toContain("source_layers");
});

test("Alex can explore the graph, ask a cited question and open exact evidence", async ({ page, context }) => {
  const errors: string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await login(context, "Alex"); await page.goto("/");
  await expect(page.getByRole("heading", { name: /A bigger picture/ })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  const workspace = await (await context.request.get("/api/workspace")).json();
  expect(workspace.stats.sources).toBe(74);expect(workspace.stats.nodes).toBe(565);
  expect(workspace.sources.every((s:Record<string,unknown>)=>!("content" in s))).toBeTruthy();
  expect(workspace.settings).not.toHaveProperty("apiKey");
  await page.getByLabel("Ask your knowledge a question").fill("What is a personal year?");
  await page.getByRole("button", { name: "Ask question", exact: true }).click();
  await expect(page.getByText("What is a personal year?", { exact: true })).toBeVisible();
  const answer = await context.request.post("/api/ask", { data: { question: "What does personal year 7 mean?" }, headers: { Origin: origin } });
  expect(answer.status()).toBe(200); const data=await answer.json(); expect(data.citations.length).toBeGreaterThan(0); expect(data.mode).toBe("extractive");
  const first=data.citations[0]; const passage=await (await context.request.get(`/api/passage?id=${first.id}`)).json();
  expect(passage.text).toBe(first.text); const source=await (await context.request.get(`/api/source?id=${first.sourceId}`)).json(); expect(source.content).toContain(first.text);
  const absent=await (await context.request.post("/api/ask",{data:{question:"quantum superconductors cure allergies"},headers:{Origin:origin}})).json();expect(absent.mode).toBe("not-found");
  await page.getByRole("button", { name: "The brain", exact: true }).click();
  await page.screenshot({path:"test-results/brain-desktop.png",fullPage:true});
  expect(errors).toEqual([]);
});

test("drafts and workflow results persist; stale draft revisions are rejected", async ({ context }) => {
  await login(context,"Alex");
  const created=await context.request.post("/api/drafts",{data:{brief:"Personal year reflection and numerology",title:"Verification evidence outline"},headers:{Origin:origin}});
  expect(created.status()).toBe(200);const draft=await created.json();expect(draft.citations.length).toBeGreaterThan(0);
  const changed={id:draft.id,title:draft.title,text:draft.text,status:"outline",revision:draft.revision};
  expect((await context.request.patch("/api/drafts",{data:changed,headers:{Origin:origin}})).status()).toBe(200);
  expect((await context.request.patch("/api/drafts",{data:changed,headers:{Origin:origin}})).status()).toBe(409);
  const run=await context.request.post("/api/workflows",{data:{kind:"knowledge-audit",question:""},headers:{Origin:origin}});expect(run.status()).toBe(200);
  const reloaded=await (await context.request.get("/api/workspace")).json();expect(reloaded.drafts.some((d:{id:string})=>d.id===draft.id)).toBeTruthy();expect(reloaded.runs.length).toBeGreaterThan(0);
  expect((await context.request.post("/api/workflows",{data:{kind:"knowledge-audit"},headers:{Origin:"https://other.example"}})).status()).toBe(403);
});

test("Peter can use the shared library but cannot change provider settings", async ({ page, context }) => {
  await login(context,"Peter"); const data=await (await context.request.get("/api/workspace")).json();expect(data.user.role).toBe("member");expect(data.stats.sources).toBe(74);
  expect((await context.request.post("/api/settings",{data:{model:"deepseek-chat",writingInstructions:"test"},headers:{Origin:origin}})).status()).toBe(403);
  await page.setViewportSize({width:390,height:844});await page.goto("/");await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("canvas")).toHaveAttribute("data-rendered", "true");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  await page.screenshot({path:"test-results/brain-mobile.png",fullPage:true});
});
