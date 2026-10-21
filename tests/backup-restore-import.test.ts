import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { createBackup, restoreBackup } from "../scripts/backup-format";

test("cloud recovery import verifies hashes, rejects source-only archives, and never overwrites differing destination records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "secondbrain-import-backup-"));
  try {
    const key = randomBytes(32), source = path.join(root, "record.json");
    await writeFile(source, JSON.stringify({ value: "test-only-backup-record" }));
    const entries = ["settings.json", "brains.json", "corpus.json"].map(name => ({ source, name: `cloud/secondbrain/${name}` }));
    const archive = path.join(root, "archive"), restored = path.join(root, "restored");
    await createBackup(entries, archive, key, { completeCloudState: true, description: "test" });
    await restoreBackup(archive, restored, key);
    const run = (args: string[]) => spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", ...args], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    const dry = run(["scripts/restore-brain-to-supabase.ts", restored]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).writes, 0);
    const blocked = run(["--input-type=module", "-e", `
      process.argv=[process.execPath,'scripts/restore-brain-to-supabase.ts',${JSON.stringify(restored)},'--apply'];
      process.env.BRAIN_SUPABASE_URL='https://backupfixture.supabase.co';
      process.env.BRAIN_SUPABASE_GATEWAY_TOKEN='x'.repeat(43);
      let writes=0;
      globalThis.fetch=async(url,options)=>{
        const body=JSON.parse(options.body);
        if(body.op==='write'){writes++;throw new Error('A conflict must not be overwritten');}
        return Response.json({record:{value:{different:'existing-data'},etag:'old'}});
      };
      process.on('exit',()=>console.log(JSON.stringify({writes})));
      await import('./scripts/restore-brain-to-supabase.ts');
    `]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /nothing was overwritten/);
    assert.equal(JSON.parse(blocked.stdout).writes, 0);
    await writeFile(path.join(restored, "cloud/secondbrain/corpus.json"), "{}");
    assert.match(run(["scripts/restore-brain-to-supabase.ts", restored]).stderr, /changed after its integrity check/);
    const markerPath = path.join(restored, ".secondbrain-restore-verified.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.completeCloudState = false; await writeFile(markerPath, JSON.stringify(marker));
    assert.match(run(["scripts/restore-brain-to-supabase.ts", restored]).stderr, /Source-only archives cannot replace/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
