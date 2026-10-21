import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadRecoverySourcePlan } from "./recovery-source-plan";
import { supabaseRead, supabaseWrite, supabaseReadOriginal, supabaseWriteOriginal } from "../src/lib/supabase-storage";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function privateKeyInput(): Promise<string> {
  assert.ok(process.stdin.isTTY, "Use an interactive terminal for hidden credential entry");
  process.stdin.setRawMode(true); process.stdin.resume();
  console.log("Ready for model credential (input hidden)");
  return new Promise((resolve, reject) => {
    let text = "";
    const receive = (chunk: Buffer) => {
      for (const ch of chunk.toString()) {
        if (ch === "\u0003") process.exit(130);
        if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", receive); process.stdin.setRawMode(false); process.stdin.pause();
          if (!/^sk-or-v1-[A-Za-z0-9_-]+$/.test(text.trim())) reject(new Error("Invalid OpenRouter credential format"));
          else resolve(text.trim());
          return;
        }
        text += ch;
      }
    };
    process.stdin.on("data", receive);
  });
}
function encryptKey(text: string) {
  const secret = process.env.BRAIN_SESSION_SECRET;
  assert.ok(secret && secret.length >= 32, "Existing workspace encryption secret required");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const bytes = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(b => b.toString("base64")).join(".");
}
async function main() {
  assert.equal(process.env.BRAIN_SUPABASE_URL, "https://gocduruhpoyshixuqhrc.supabase.co", "Refusing a different destination");
  assert.ok(process.env.BRAIN_SUPABASE_GATEWAY_TOKEN, "Dedicated private Supabase connection required");
  const apply = process.argv.includes("--apply");
  const plan = await loadRecoverySourcePlan();
  assert.equal(plan.mainCorpus.sources.length, 74);
  assert.equal(plan.astrologyCorpus.sources.length, 3);
  assert.equal(plan.photoManifest.uniqueCount, 1028);
  const settingsKey = "secondbrain/settings.json";
  const previousSettings = await supabaseRead<Record<string, unknown>>(settingsKey);
  const writingInstructions = (await readFile("private/migration/recovery-writing-instructions.txt", "utf8")).trim();
  assert.ok(writingInstructions.length > 4000, "Original writing guidance must be preserved");
  let settings: Record<string, unknown> = { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash-1017", writingInstructions };
  if (previousSettings) {
    assert.equal(previousSettings.value.provider, settings.provider);
    assert.equal(previousSettings.value.model, settings.model);
    assert.equal(previousSettings.value.writingInstructions, writingInstructions, "Existing writing settings differ; not overwritten");
    settings = previousSettings.value;
  } else if (apply && process.argv.includes("--with-key")) {
    const key = await privateKeyInput();
    const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) });
    assert.equal(response.status, 200, "Provider did not accept this credential; nothing imported");
    await response.body?.cancel();
    settings.encryptedKey = encryptKey(key);
  }
  const recoveryKey = "secondbrain/recovery-state.json";
  const existingRecovery = await supabaseRead<Record<string, unknown>>(recoveryKey);
  const restoredAt = typeof existingRecovery?.value.restoredAt === "string" ? existingRecovery.value.restoredAt : new Date().toISOString();
  const recovery = {
    version: 1, pendingCloudRecovery: true, extractionBlocked: true, restoredAt,
    sourceSnapshotDate: plan.mainCorpus.snapshotDate,
    originalBrainId: plan.recoveryReport.originalBrainId, recoveredBrainId: plan.astrologyBrain.id,
    sourceFingerprint: plan.recoveryReport.sourceFingerprint,
    unavailableOriginalJobId: "03478f99-4e19-4fa9-a376-899ec53f657c",
    historicalSpending: "unknown-not-reset", completeLegacyCloudState: false,
  };
  const brainPrefix = `secondbrain/brains/${plan.astrologyBrain.id}`;
  const records: [string, unknown][] = [
    [recoveryKey, recovery],
    ["secondbrain/corpus.json", plan.mainCorpus],
    [`${brainPrefix}/corpus.json`, plan.astrologyCorpus],
    [`${brainPrefix}/knowledge/original-photo-manifest.json`, { ...plan.photoManifest, originalFiles: plan.photoManifest.originalFiles.map(({ path: _path, ...entry }) => entry) }],
    [`${brainPrefix}/knowledge/recovery-provenance.json`, plan.recoveryReport],
    ...(plan.requirementsProfile ? [[`${brainPrefix}/knowledge-question-profile.json`, plan.requirementsProfile] as [string, unknown]] : []),
    [settingsKey, settings],
    ["secondbrain/brains.json", [{ id: "main", name: "Main brain", description: "Your original shared knowledge library.", createdAt: "", createdBy: "Alex" }, plan.astrologyBrain]],
  ];
  // Preflight every record before the first write. Different existing data is NEVER replaced.
  for (const [key, value] of records) {
    assert.ok(Buffer.byteLength(JSON.stringify({op:"write",key,value})) < 20 * 1024 * 1024, "Record exceeds private gateway limit");
    const existing = await supabaseRead(key);
    if (existing) assert.equal(digest(canonical(existing.value)), digest(canonical(value)), `Destination differs at ${key}; nothing overwritten`);
  }
  for (const original of plan.originals) assert.equal(digest(await readFile(original.path)), original.sha256);
  const manifest = {
    version: 1, kind: "source-only-recovery", completeLegacyCloudState: false, complete: false,
    destination: process.env.BRAIN_SUPABASE_URL, restoredAt, sourceFingerprint: plan.recoveryReport.sourceFingerprint,
    recoveryBrainId: plan.astrologyBrain.id, counts: plan.recoveryReport.counts,
    records: [] as {key:string;sha256:string}[], originals: [] as {key:string;sha256:string}[],
  };
  console.log(JSON.stringify({apply, records:records.length, originals:plan.originals.length, counts:plan.recoveryReport.counts, extractionBlocked:true, modelCredentialConnected:typeof settings.encryptedKey === "string", completeLegacyCloudState:false}));
  if (!apply) return;
  const folder = "private/migration/local-source-recovery";
  await mkdir(folder, {recursive:true});
  const save = () => writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2), {mode:0o600});
  await save();
  for (const [key, value] of records) {
    if (!(await supabaseRead(key))) await supabaseWrite(key, value, null);
    const copied = await supabaseRead(key);
    assert.ok(copied);
    const sha256 = digest(canonical(value));
    assert.equal(digest(canonical(copied.value)), sha256, "Record read-back fingerprint mismatch");
    manifest.records.push({key,sha256}); await save();
    console.log(JSON.stringify({verifiedRecord:key}));
  }
  for (const original of plan.originals) {
    const key = `secondbrain/brains/${original.brainId}/originals/${original.sourceId}.${original.format}`;
    const bytes = await readFile(original.path);
    if (!(await supabaseReadOriginal(key))) await supabaseWriteOriginal(key, bytes);
    const downloaded = await supabaseReadOriginal(key); assert.ok(downloaded);
    assert.equal(digest(new Uint8Array(await new Response(downloaded).arrayBuffer())), original.sha256, "Private PDF read-back fingerprint mismatch");
    manifest.originals.push({key,sha256:original.sha256}); await save();
    console.log(JSON.stringify({verifiedOriginal:key}));
  }
  manifest.complete = true; await save();
  console.log(JSON.stringify({complete:true,completeLegacyCloudState:false,manifest:path.join(folder,"manifest.json"),records:manifest.records.length,originals:manifest.originals.length,paidModelCalls:0,productionSwitched:false}));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Source recovery stopped without changing production");
  if (error instanceof Error && error.cause && typeof error.cause === "object") {
    const cause = error.cause as { code?: string; name?: string };
    console.error(JSON.stringify({ transportError: cause.code ?? cause.name ?? "unknown", productionSwitched: false }));
  }
  process.exitCode=1;
});
