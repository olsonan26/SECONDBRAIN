// Runs on GitHub's standard runner: preserve exact source JPEGs without sending
// gigabytes through the user's upload connection. No model calls or Drive writes.
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { createBackup, restoreBackup, parseBackupKey, validBackupPath, type BackupEntry } from "./backup-format";
import { readPassageImage } from "../src/lib/knowledge-images";
import type { Passage } from "../src/lib/types";

async function run(program: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error(`Backup step failed (${code})`)));
  });
}
async function main() {
  const seedTag = process.env.BRAIN_SOURCE_SEED_TAG;
  if (!seedTag || !/^brain-backup-[a-zA-Z0-9-]+$/.test(seedTag)) throw new Error("A verified seed release tag is required");
  const key = parseBackupKey(process.env.BRAIN_BACKUP_KEY || "");
  const root = path.resolve("private/github-backups/runner-assembly");
  const seed = path.join(root, "seed"), source = path.join(root, "source"), archive = path.join(root, "archive"), restored = path.join(root, "restored");
  await mkdir(seed, { recursive: true });
  await run("gh", ["release", "download", seedTag, "--repo", "olsonan26/SECONDBRAIN", "--dir", seed, "--pattern", "manifest.json", "--pattern", "archive.part-*.bin"]);
  await restoreBackup(seed, source, key);
  const plan = JSON.parse(await readFile(path.join(source, "recovery-source-plan.json"), "utf8")) as { name: string; driveId: string; bytes: number; sha256: string; mimeType: string }[];
  if (plan.length !== 1029 || new Set(plan.map(p => p.name)).size !== plan.length) throw new Error("Incomplete or duplicate source-photo plan");
  let next = 0, completed = 0;
  const started = Date.now();
  async function worker() {
    while (next < plan.length) {
      const photo = plan[next++];
      if (!validBackupPath(photo.name) || !photo.name.startsWith("original-page-photographs/") || photo.mimeType !== "image/jpeg") throw new Error("Invalid source-photo metadata");
      let bytes: Uint8Array | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { bytes = await readPassageImage({ image: { id: photo.driveId, driveId: photo.driveId, sha256: photo.sha256, mimeType: "image/jpeg", filename: photo.name } } as Passage); break; }
        catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1))); }
      }
      if (!bytes || bytes.length !== photo.bytes || createHash("sha256").update(bytes).digest("hex") !== photo.sha256) throw new Error("Photo does not match its original local fingerprint");
      const target = path.join(source, ...photo.name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
      completed++;
      if (completed % 25 === 0 || completed === plan.length) console.log(JSON.stringify({ verifiedPhotos: completed, totalPhotos: plan.length, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const entries: BackupEntry[] = [];
  async function collect(directory: string, prefix = "") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name, file = path.join(directory, item.name);
      if (item.isDirectory()) await collect(file, name);
      else if (item.isFile()) entries.push({ source: file, name });
      else throw new Error("Unexpected link in verified source staging area");
    }
  }
  await collect(source);
  const manifest = await createBackup(entries, archive, key, { completeCloudState: false, description: "Verified original sources: all 1,029 Drive page photographs, their OCR, both PDFs, local Main corpus, requirements/source audits, and encrypted local recovery configuration. Latest Vercel-only drafts, Astrology nodes and scan checkpoints remain unrecovered." });
  console.log(JSON.stringify({ assembledFiles: manifest.files, originalBytes: manifest.originalBytes, parts: manifest.parts.length }));
  console.log(JSON.stringify(await restoreBackup(archive, restored, key)));
  const tag = `brain-backup-sources-${process.env.GITHUB_RUN_ID || Date.now()}`;
  await run(process.execPath, ["--import", "tsx", "scripts/brain-backup.ts", "publish", archive, tag]);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Source assembly failed; no complete archive was published"); process.exitCode = 1; });
