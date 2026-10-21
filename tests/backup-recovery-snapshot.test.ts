import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { restoreBackup } from "../scripts/backup-format";

const recoveryBrainId = "5c9e08c7-21fd-4c8e-95a1-1c6830ff092d";
const settings = { provider: "openrouter", model: "deepseek/test-not-real", writingInstructions: "private editorial instructions" };
const recovery = { version: 1, pendingCloudRecovery: true, extractionBlocked: true, sourceSnapshotDate: "2026-05-14", restoredAt: "2026-10-21T18:30:00.000Z" };
const corpus = { sources: [{ id: "source-one", format: "pdf", originalAvailable: false }], passages: [{ id: "p-one", sourceId: "source-one", text: "Source teaching, not an accepted extracted node." }], nodes: [], edges: [] };
const rows = [
  { key: "secondbrain/settings.json", value: settings, etag: "settings-version" },
  { key: "secondbrain/recovery-state.json", value: recovery, etag: "recovery-version" },
  { key: "secondbrain/brains.json", value: [{ id: "main" }, { id: recoveryBrainId }], etag: "registry-version" },
  { key: "secondbrain/corpus.json", value: corpus, etag: "main-version" },
  { key: `secondbrain/brains/${recoveryBrainId}/corpus.json`, value: { ...corpus, sources: [{ id: "source-one", format: "pdf", originalAvailable: true }] }, etag: "recovered-version" },
  { key: "secondbrain/drafts/new-supabase-draft.json", value: { text: "Newly saved current work, not a recovered legacy draft." }, etag: "draft-version" },
  { key: "secondbrain/_diagnostics/probe.json", value: { private: true }, etag: "diagnostic-version" },
].sort((a, b) => a.key.localeCompare(b.key));

function runSnapshot(directory: string, key: Buffer, recordRows: unknown[], options: { mode?: string; backend?: string; changed?: boolean } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const records=${JSON.stringify(recordRows)};
    process.argv=[process.execPath,'scripts/brain-backup.ts',${JSON.stringify(options.mode || "recovery-snapshot")},${JSON.stringify(directory)}];
    process.env.BRAIN_BACKUP_BACKEND=${JSON.stringify(options.backend || "supabase")};
    process.env.BRAIN_BACKUP_KEY=${JSON.stringify(key.toString("base64url"))};
    process.env.BRAIN_SUPABASE_URL='https://snapshotfixture.supabase.co';
    process.env.BRAIN_SUPABASE_GATEWAY_TOKEN='x'.repeat(43);
    let inventories=0;
    globalThis.fetch=async(url,options)=>{
      assert.match(String(url),/^https:\\/\\/snapshotfixture\\.supabase\\.co\\/functions\\/v1\\/secondbrain-storage/);
      assert.equal(options.headers.Authorization,'Bearer '+'x'.repeat(43));
      if(!options.method||options.method==='GET')return new Response(new Uint8Array([37,80,68,70,45,49]));
      const input=JSON.parse(options.body);
      if(input.op==='read')return Response.json({record:records.find(r=>r.key===input.key)||null});
      assert.equal(input.op,'list','Snapshot must never write to the source');
      inventories++;
      const output=${options.changed ? "inventories>1?records.map((r,i)=>i===0?{...r,etag:'changed'}:r):records" : "records"};
      return Response.json({records:output});
    };
    await import('./scripts/brain-backup.ts');
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, windowsHide: true });
}

test("recovery snapshot encrypts every current Supabase record and referenced original but never claims recovered legacy cloud", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-recovery-snapshot-"));
  try {
    const key = randomBytes(32), archive = path.join(root, "archive");
    const result = runSnapshot(archive, key, rows);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(archive, "manifest.json"), "utf8"));
    assert.equal(manifest.completeCloudState, false);
    assert.deepEqual(manifest.recoverySnapshot, { version: 1, backend: "supabase", currentSupabaseRecordsIncluded: true, pendingLegacyCloudRecovery: true });
    assert.match(manifest.description, /LEGACY VERCEL CLOUD STATE IS STILL INCOMPLETE/);
    assert.doesNotMatch(JSON.stringify(manifest), /private editorial instructions/);
    const restored = path.join(root, "restored");
    const verified = await restoreBackup(archive, restored, key);
    assert.equal(verified.completeCloudState, false);
    assert.equal(verified.files, rows.length + 2, "Every row, original PDF and encrypted recovery metadata must be included");
    for (const row of rows) assert.deepEqual(JSON.parse(await readFile(path.join(restored, "cloud", ...row.key.split("/")), "utf8")), row.value);
    assert.deepEqual(await readFile(path.join(restored, "cloud", "secondbrain", "brains", recoveryBrainId, "originals", "source-one.pdf")), Buffer.from([37, 80, 68, 70, 45, 49]));
    const metadata = JSON.parse(await readFile(path.join(restored, "snapshot-metadata", "recovery-snapshot.json"), "utf8"));
    assert.equal(metadata.pendingLegacyCloudRecovery, true);
    assert.equal(metadata.completeCloudState, false);
    assert.equal(metadata.records, rows.length);
    assert.equal(metadata.sourceSnapshotDate, recovery.sourceSnapshotDate);
    assert.equal(metadata.restoredAt, recovery.restoredAt);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery snapshots reject empty, malformed, wrong-backend or moving source state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-recovery-rejected-"));
  try {
    const key = randomBytes(32);
    const invalid = [
      rows.filter(row => row.key !== "secondbrain/recovery-state.json"),
      rows.map(row => row.key === "secondbrain/recovery-state.json" ? { ...row, value: { ...recovery, pendingCloudRecovery: false } } : row),
      rows.map(row => row.key === "secondbrain/recovery-state.json" ? { ...row, value: { ...recovery, restoredAt: "not-a-date" } } : row),
      rows.map(row => row.key === "secondbrain/corpus.json" ? { ...row, value: { ...corpus, sources: [] } } : row),
      rows.map(row => row.key === "secondbrain/brains.json" ? { ...row, value: [{ id: "local-fixture-brain" }] } : row),
      rows.filter(row => row.key !== "secondbrain/settings.json"),
    ];
    for (const [index, records] of invalid.entries()) {
      const directory = path.join(root, `invalid-${index}`), result = runSnapshot(directory, key, records);
      assert.equal(result.status, 1, `Invalid source ${index} was accepted: ${result.stdout}`);
      await assert.rejects(() => stat(path.join(directory, "manifest.json")), /ENOENT/);
    }
    const changed = runSnapshot(path.join(root, "changed"), key, rows, { changed: true });
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Workspace changed during backup/);
    const blob = runSnapshot(path.join(root, "blob"), key, rows, { backend: "blob" });
    assert.equal(blob.status, 1);
    assert.match(blob.stderr, /Supabase-only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery backup decodes storage envelopes and preserves original NUL-containing source text exactly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-recovery-codec-"));
  try {
    const key = randomBytes(32), archive = path.join(root, "archive");
    const exactCorpus = { ...corpus, passages: [{ ...corpus.passages[0], text: "Original OCR character\u0000must remain unchanged." }] };
    const json = JSON.stringify(exactCorpus);
    const envelope = { __secondbrain_record_encoding__: "json-base64-v1", jsonBase64: Buffer.from(json).toString("base64"), sha256: createHash("sha256").update(json).digest("hex") };
    const encodedRows = rows.map(row => row.key === `secondbrain/brains/${recoveryBrainId}/corpus.json` ? { ...row, value: envelope } : row);
    const result = runSnapshot(archive, key, encodedRows);
    assert.equal(result.status, 0, result.stderr);
    const restored = path.join(root, "restored");
    await restoreBackup(archive, restored, key);
    const restoredCorpus = JSON.parse(await readFile(path.join(restored, "cloud", "secondbrain", "brains", recoveryBrainId, "corpus.json"), "utf8"));
    assert.deepEqual(restoredCorpus, exactCorpus);
    assert.equal(restoredCorpus.passages[0].text.includes("\u0000"), true);
    assert.equal("__secondbrain_record_encoding__" in restoredCorpus, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("normal complete-cloud backup requirements still reject source-recovery records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-complete-guard-"));
  try {
    const result = runSnapshot(path.join(root, "archive"), randomBytes(32), rows, { mode: "cloud" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /lacks an expected live-workspace record/);
    await assert.rejects(() => stat(path.join(root, "archive", "manifest.json")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery publication refuses contradictory completeness metadata before any GitHub operation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-recovery-publish-"));
  try {
    const key = randomBytes(32), archive = path.join(root, "archive");
    assert.equal(runSnapshot(archive, key, rows).status, 0);
    const manifestPath = path.join(archive, "manifest.json");
    const { writeFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.completeCloudState = true;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/brain-backup.ts", "publish", archive, "brain-backup-test-recovery-invalid"], { encoding: "utf8", timeout: 30_000, windowsHide: true, env: { ...process.env, BRAIN_BACKUP_KEY: key.toString("base64url") } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must preserve incomplete legacy cloud status/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery publication requires a full authenticated restore before any GitHub operation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-recovery-authentication-"));
  try {
    const key = randomBytes(32), archive = path.join(root, "archive");
    assert.equal(runSnapshot(archive, key, rows).status, 0);
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/brain-backup.ts", "publish", archive, "brain-backup-test-recovery-wrong-key"], { encoding: "utf8", timeout: 30_000, windowsHide: true, env: { ...process.env, BRAIN_BACKUP_KEY: randomBytes(32).toString("base64url") } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Wrong recovery key/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
