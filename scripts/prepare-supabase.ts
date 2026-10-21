// Generates private credentials once. Never prints the gateway token.
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

async function main() {
const project = process.env.SECONDBRAIN_SUPABASE_PROJECT;
if (!project || !/^[a-z0-9]{20}$/.test(project)) throw new Error("Set SECONDBRAIN_SUPABASE_PROJECT to the dedicated project ref");
let token: string;
try {
  const env = await readFile(".env.supabase.local", "utf8");
  token = env.match(/^BRAIN_SUPABASE_GATEWAY_TOKEN=([a-zA-Z0-9_-]+)$/m)?.[1] ?? "";
  if (!env.includes(`https://${project}.supabase.co`) || token.length < 40) throw new Error("Existing Supabase configuration differs; refusing to replace it");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  token = randomBytes(32).toString("base64url");
  await writeFile(".env.supabase.local", `BRAIN_SUPABASE_URL=https://${project}.supabase.co\nBRAIN_SUPABASE_GATEWAY_TOKEN=${token}\n`, { mode: 0o600, flag: "wx" });
}
const fingerprint = createHash("sha256").update(token).digest("hex");
const folder = "supabase/functions/secondbrain-storage";
const files = await Promise.all(["index.ts", "handler.ts", "deno.json"].map(async name => ({ name, content: await readFile(path.join(folder, name), "utf8") })));
files.push({ name: "auth-config.ts", content: `export const tokenSha256 = ${JSON.stringify(fingerprint)};\n` });
await mkdir("private/migration", { recursive: true });
await writeFile("private/migration/supabase-function.json", JSON.stringify({ project_id: project, name: "secondbrain-storage", entrypoint_path: "index.ts", import_map_path: "deno.json", verify_jwt: false, files }), { mode: 0o600 });
console.log(JSON.stringify({ project, fingerprint, deploymentSource: "private/migration/supabase-function.json", backendSwitched: false }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Supabase preparation failed"); process.exitCode = 1; });
