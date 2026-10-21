import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createBackup, restoreBackup, validBackupPath } from "../scripts/backup-format";

test("encrypted multipart backups restore every byte, reject tampering/wrong keys, and never overwrite a destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-backup-"));
  try {
    const key = randomBytes(32), source = path.join(root, "source.bin"), secret = path.join(root, "config.txt");
    const bytes = randomBytes(9000);
    await writeFile(source, bytes); await writeFile(secret, "private-test-credential-not-for-publication");
    const archive = path.join(root, "archive");
    const manifest = await createBackup([{ source, name: "photos/page.jpg" }, { source: secret, name: "recovery/config.txt" }], archive, key, { completeCloudState: false, description: "test" }, 2048);
    assert.ok(manifest.parts.length > 1);
    for (const part of manifest.parts) assert.equal((await readFile(path.join(archive, part.name))).includes(Buffer.from("private-test-credential")), false);
    await assert.rejects(() => restoreBackup(archive, path.join(root, "wrong"), randomBytes(32)), /Wrong recovery key/);
    const destination = path.join(root, "restored");
    assert.deepEqual(await restoreBackup(archive, destination, key), { files: 2, bytes: 9000 + Buffer.byteLength("private-test-credential-not-for-publication"), completeCloudState: false });
    assert.deepEqual(await readFile(path.join(destination, "photos/page.jpg")), bytes);
    const marker = JSON.parse(await readFile(path.join(destination, ".secondbrain-restore-verified.json"), "utf8"));
    assert.equal(marker.completeCloudState, false);
    assert.equal(marker.files.length, 2);
    assert.equal(await readFile(path.join(destination, "recovery/config.txt"), "utf8"), "private-test-credential-not-for-publication");
    await assert.rejects(() => restoreBackup(archive, destination, key), /exist/i);
    const file = path.join(archive, manifest.parts[0].name), corrupt = await readFile(file);
    corrupt[0] ^= 1; await writeFile(file, corrupt);
    await assert.rejects(() => restoreBackup(archive, path.join(root, "tampered"), key), /integrity/);
    assert.equal(validBackupPath("../.env"), false);
    assert.equal(validBackupPath("C:/outside.txt"), false);
    assert.equal(validBackupPath("safe/../../outside.txt"), false);
    assert.equal(validBackupPath("safe/file.json"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
