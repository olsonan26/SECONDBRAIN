import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { publicRecoveryState, RECOVERY_EXTRACTION_BLOCK_MESSAGE } from "../src/lib/recovery-state-core";

const pending = { version: 1, pendingCloudRecovery: true, extractionBlocked: true, sourceSnapshotDate: "2026-05-14", restoredAt: "2026-10-21T18:30:00.000Z" };

test("recovery metadata preserves source dates and never pretends the original cloud work was restored", () => {
  const status = publicRecoveryState(pending)!;
  assert.equal(status.pendingCloudRecovery, true);
  assert.equal(status.extractionBlocked, true);
  assert.equal(status.sourceSnapshotDate, pending.sourceSnapshotDate);
  assert.equal(status.restoredAt, pending.restoredAt);
  assert.match(status.message, /still await recovery/);
  assert.match(RECOVERY_EXTRACTION_BLOCK_MESSAGE, /spending ledger/);
});

test("public conversion whitelists metadata, never exposes arbitrary stored messages or private values", () => {
  const status = publicRecoveryState({ ...pending, message: "private credential sentinel", apiKey: "private credential sentinel", originalJob: { costUsd: 0, checkpoint: "invented" }, privateInventory: ["draft-title"] })!;
  assert.deepEqual(Object.keys(status).sort(), ["pendingCloudRecovery", "message", "extractionBlocked", "sourceSnapshotDate", "restoredAt"].sort());
  assert.doesNotMatch(JSON.stringify(status), /private credential sentinel|invented|costUsd|draft-title/);
});

test("malformed or contradictory present records fail closed and do not leak malformed date contents", () => {
  for (const bad of [false, [], "secret", {}, { ...pending, version: 2 }, { ...pending, extractionBlocked: undefined }, { ...pending, pendingCloudRecovery: "false" }, { ...pending, pendingCloudRecovery: false }, { ...pending, sourceSnapshotDate: "2026-02-30" }, { ...pending, sourceSnapshotDate: "private date sentinel" }, { ...pending, restoredAt: "2026-10-21" }, { ...pending, restoredAt: "2026-02-30T18:30:00.000Z" }]) {
    const status = publicRecoveryState(bad)!;
    assert.equal(status.pendingCloudRecovery, true);
    assert.equal(status.extractionBlocked, true);
    assert.equal(status.sourceSnapshotDate, null);
    assert.equal(status.restoredAt, null);
    assert.doesNotMatch(JSON.stringify(status), /private date sentinel/);
  }
});

test("absence preserves pre-recovery workspaces, and explicit verified release does not invent a spending value", () => {
  assert.equal(publicRecoveryState(null), null);
  assert.equal(publicRecoveryState(undefined), null);
  const released = publicRecoveryState({ ...pending, pendingCloudRecovery: false, extractionBlocked: false, sourceSnapshotDate: null })!;
  assert.equal(released.extractionBlocked, false);
  assert.equal(released.pendingCloudRecovery, false);
  assert.equal(released.sourceSnapshotDate, null);
  assert.equal("spentUsd" in released, false);
});

test("pending historical recovery cannot silently unlock a replacement paid scan", () => {
  const status = publicRecoveryState({ ...pending, extractionBlocked: false })!;
  assert.equal(status.pendingCloudRecovery, true);
  assert.equal(status.extractionBlocked, true);
});

test("server guard reads durable status, rejects with HTTP 409 and never calls a model or resets records", () => {
  const script = `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    process.env.BRAIN_STORAGE_BACKEND='local';
    delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.BLOB_STORE_ID; delete process.env.VERCEL;
    const load=async p=>{const m=await import(p);return m.default||m;};
    const {writeRecord,readRecord}=await load('./src/lib/storage.ts');
    const {getRecoveryState,assertExtractionRecoverySafe}=await load('./src/lib/recovery-state.ts');
    const root=process.cwd(),temp=await mkdtemp(path.join(os.tmpdir(),'secondbrain-recovery-'));
    let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Network calls are forbidden in recovery guard');};
    process.chdir(temp);
    try {
      assert.equal(await getRecoveryState(),null);await assertExtractionRecoverySafe();
      const source=${JSON.stringify(pending)};
      await writeRecord('recovery-state.json',source);
      const before=await readRecord('recovery-state.json');
      await assert.rejects(()=>assertExtractionRecoverySafe(),e=>e.status===409&&/spending ledger/.test(e.message));
      assert.deepEqual(await readRecord('recovery-state.json'),before);
      await writeRecord('recovery-state.json',{...source,extractionBlocked:'false'});
      await assert.rejects(()=>assertExtractionRecoverySafe(),e=>e.status===409);
      await writeRecord('recovery-state.json',{...source,pendingCloudRecovery:false,extractionBlocked:false});
      await assertExtractionRecoverySafe();
      assert.equal(calls,0);
    } finally {process.chdir(root);await rm(temp,{recursive:true,force:true});}
  `;
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
