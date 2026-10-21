import { randomBytes } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { get, list } from "@vercel/blob";
import { createBackup, restoreBackup, parseBackupKey, fileHash, type BackupEntry, type BackupManifest } from "./backup-format";
import { publicRecoveryState } from "../src/lib/recovery-state-core";
import { decodeSupabaseRecord } from "../src/lib/supabase-record-codec";

const repository = "olsonan26/SECONDBRAIN";
const root = path.resolve("private/github-backups");
const keyPath = path.resolve("private/backup-recovery/RECOVERY-KEY.txt");
const recoveryBrainId = "5c9e08c7-21fd-4c8e-95a1-1c6830ff092d";
type RecoverySnapshotMetadata = { version: 1; backend: "supabase"; currentSupabaseRecordsIncluded: true; pendingLegacyCloudRecovery: true };
type PublishedManifest = BackupManifest & { recoverySnapshot?: RecoverySnapshotMetadata };
type SupabaseRecord = { key: string; value: unknown; etag: string };

function validateRecoverySnapshot(records: SupabaseRecord[]) {
  const values = new Map(records.map(record => [record.key, record.value]));
  const raw = values.get("secondbrain/recovery-state.json") as Record<string, unknown> | undefined;
  const recovery = publicRecoveryState(raw);
  // A malformed status also appears blocked publicly, but it is not sufficient
  // provenance for a valid recovery snapshot. Require the actual stored flags.
  if (!raw || raw.version !== 1 || raw.pendingCloudRecovery !== true || raw.extractionBlocked !== true || !recovery?.restoredAt) throw new Error("Recovery snapshots require a valid pending, extraction-blocked recovery-state.json");
  const settings = values.get("secondbrain/settings.json") as Record<string, unknown> | undefined;
  if (!settings || !["deepseek", "openrouter"].includes(String(settings.provider)) || typeof settings.model !== "string" || !settings.model.trim() || typeof settings.writingInstructions !== "string") throw new Error("Recovery settings are missing or invalid; refusing an empty snapshot");
  const brains = values.get("secondbrain/brains.json");
  if (!Array.isArray(brains) || !brains.some(brain => brain?.id === recoveryBrainId)) throw new Error("The separately identified source-recovery Astrology brain is missing");
  for (const key of ["secondbrain/corpus.json", `secondbrain/brains/${recoveryBrainId}/corpus.json`]) {
    const corpus = values.get(key) as { sources?: { id: string }[]; passages?: { sourceId: string }[]; nodes?: unknown[]; edges?: unknown[] } | undefined;
    if (!corpus || !Array.isArray(corpus.sources) || !corpus.sources.length || !Array.isArray(corpus.passages) || !corpus.passages.length || !Array.isArray(corpus.nodes) || !Array.isArray(corpus.edges)) throw new Error("A required recovered corpus is empty or invalid");
    const ids = new Set(corpus.sources.map(source => source.id));
    if (ids.size !== corpus.sources.length || corpus.passages.some(passage => !ids.has(passage.sourceId))) throw new Error("Recovered corpus provenance is inconsistent");
  }
  return recovery;
}
async function exists(file: string) { try { return (await stat(file)).isFile(); } catch { return false; } }
async function recoveryKey(create = false) {
  if (process.env.BRAIN_BACKUP_KEY) return parseBackupKey(process.env.BRAIN_BACKUP_KEY);
  if (!await exists(keyPath)) {
    if (!create) throw new Error("Supply BRAIN_BACKUP_KEY or the original private recovery-key file");
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(keyPath, randomBytes(32).toString("base64url") + "\n", { flag: "wx", mode: 0o600 });
  }
  return parseBackupKey(await readFile(keyPath, "utf8"));
}
async function command(args: string[], input?: string, program = "gh") {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(`GitHub operation failed (${code}): ${error.slice(0, 600)}`)));
    child.stdin.end(input);
  });
}
async function add(entries: BackupEntry[], source: string, name: string, required = true) {
  if (!await exists(source)) { if (required) throw new Error(`Required source is missing: ${name}`); return; }
  entries.push({ source: path.resolve(source), name });
}
async function localEntries() {
  const entries: BackupEntry[] = [];
  await add(entries, "private/corpus.json", "local-main-brain/corpus.json");
  for (const name of ["astrology-extraction-scope.txt", "astrology-manual-source-review.json", "astrology-page-audit.json", "astrology-photo-alignment.json", "astrology-source-inventory.json"]) await add(entries, `private/${name}`, `source-audits/${name}`);
  for (const name of (await readdir("private/astrology-photos")).sort()) if (/\.(jpg|ocr\.json)$/i.test(name)) await add(entries, `private/astrology-photos/${name}`, `original-page-photographs/${name}`);
  await add(entries, "C:/Users/olson/Downloads/Astrology book 972 pages.pdf", "original-books/Astrology-book-972-pages.pdf");
  const old = "private/brains/4201952d-07d1-4ca9-b974-ce5da4b9ee85/originals/upload-8504c3a96b79a0f19dfa.pdf";
  await add(entries, old, "original-books/PURE_ASTROLOGY_Nadia_Complete.pdf");
  for (const name of [".env.local", ".env.supabase.local", "ACCESS-PRIVATE.txt"]) await add(entries, name, `encrypted-recovery-configuration/${name}`);
  // Only the known book PDFs are taken from fixture folders. Never import
  // fixture brain registries, test jobs, test drafts, or test-generated nodes.
  await add(entries, "private/migration/blob-export/manifest.json", "unrecovered-cloud/inventory.json");
  for (const [source, name] of [
    ["C:/Users/olson/.codex/attachments/ebeab1f7-4bc6-48cc-99f7-778f5cb235d0/Pasted text.txt", "requirements/chart-reading-questions.txt"],
    ["C:/Users/olson/.codex/attachments/448d1d48-38cb-47eb-aec2-d6a88e22c6fe/Pasted text.txt", "requirements/chart-reading-topics.txt"],
    ["C:/Users/olson/Downloads/transcript of don't use obsedien.txt", "requirements/rag-video-transcript.txt"],
    ["C:/Users/olson/.codex/attachments/4f3b0839-1ff7-45b1-a65a-7cf5fa67d053/Pasted text.txt", "requirements/agentic-brain-video-transcript.txt"],
  ]) await add(entries, source, name, false);
  return entries;
}
async function supabaseCall(body: unknown) {
  const base = process.env.BRAIN_SUPABASE_URL;
  if (!base || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base) || !process.env.BRAIN_SUPABASE_GATEWAY_TOKEN) throw new Error("Dedicated Supabase backup connection is missing");
  const response = await fetch(`${base}/functions/v1/secondbrain-storage`, { method: "POST", headers: { Authorization: `Bearer ${process.env.BRAIN_SUPABASE_GATEWAY_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Supabase backup read failed (${response.status}); no snapshot was published`);
  const result = await response.json();
  // The persistence adapter may encode JSONB-incompatible source characters
  // losslessly. Backups contain the original logical records, never a second
  // layer of transport encoding or modified source text.
  if (result.record) result.record = { ...result.record, value: decodeSupabaseRecord(result.record.value) };
  if (Array.isArray(result.records)) result.records = result.records.map((record: SupabaseRecord) => ({ ...record, value: decodeSupabaseRecord(record.value) }));
  return result;
}
async function cloudEntries(directory: string, recoverySnapshot = false) {
  if (recoverySnapshot && process.env.BRAIN_BACKUP_BACKEND !== "supabase") throw new Error("Recovery snapshots are explicitly Supabase-only; no Blob fallback is allowed");
  const entries: BackupEntry[] = [];
  const stage = path.join(directory, "source-export");
  await mkdir(stage, { recursive: true });
  async function save(key: string, bytes: Buffer) {
    if (!/^secondbrain\/[a-zA-Z0-9_./-]+$/.test(key) || key.includes("..")) throw new Error("Invalid source storage key");
    const target = path.join(stage, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
    entries.push({ source: target, name: `cloud/${key}` });
  }
  if (process.env.BRAIN_BACKUP_BACKEND === "supabase") {
    const settings = await supabaseCall({ op: "read", key: "secondbrain/settings.json" });
    if (!settings.record) throw new Error("Supabase does not yet contain the migrated workspace; refusing an empty backup");
    async function inventory() {
      const records: SupabaseRecord[] = [];
      let after = "";
      for (;;) {
        const page = await supabaseCall({ op: "list", prefix: "secondbrain/", after });
        records.push(...page.records.filter((r: { key: string }) => recoverySnapshot || !r.key.startsWith("secondbrain/_diagnostics/")));
        if (page.records.length < 100) return records;
        const next = page.records.at(-1).key;
        if (next <= after) throw new Error("Invalid snapshot pagination");
        after = next;
      }
    }
    const records = await inventory();
    const recovery = recoverySnapshot ? validateRecoverySnapshot(records) : null;
    for (const record of records) {
      await save(record.key, Buffer.from(JSON.stringify(record.value)));
      if (record.key.endsWith("/corpus.json")) {
        const corpus = record.value as { sources: { id: string; format: string; originalAvailable: boolean }[] };
        for (const source of corpus.sources.filter(s => s.originalAvailable)) {
          const key = record.key.replace(/corpus\.json$/, `originals/${source.id}.${source.format}`);
          const response = await fetch(`${process.env.BRAIN_SUPABASE_URL}/functions/v1/secondbrain-storage?key=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${process.env.BRAIN_SUPABASE_GATEWAY_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
          if (response.status !== 200) throw new Error("An expected private original could not be backed up");
          await save(key, Buffer.from(await response.arrayBuffer()));
        }
      }
    }
    // Reject a moving snapshot rather than resetting or mis-stating checkpoints.
    const stamp = (rows: typeof records) => JSON.stringify(rows.map(r => [r.key, r.etag]));
    if (stamp(await inventory()) !== stamp(records)) throw new Error("Workspace changed during backup; retry when writes are quiet");
    if (recovery) {
      const metadataPath = path.join(directory, "recovery-snapshot-metadata.json");
      await writeFile(metadataPath, JSON.stringify({
        version: 1, scope: "current-recovered-supabase-workspace", completeCloudState: false,
        pendingLegacyCloudRecovery: true, recoveryBrainId, records: records.length,
        sourceSnapshotDate: recovery.sourceSnapshotDate, restoredAt: recovery.restoredAt,
        description: "Every current Supabase JSON record and its referenced private originals are included. The original Vercel-held drafts, accepted Astrology teachings, extraction checkpoint and historical spending are still unrecovered. Immutable original photographs remain in the separate encrypted source archive and original Drive collection.",
      }), { mode: 0o600, flag: "wx" });
      entries.push({ source: metadataPath, name: "snapshot-metadata/recovery-snapshot.json" });
    }
  } else if (process.env.BRAIN_BACKUP_BACKEND === "blob") {
    const probe = await get("secondbrain/settings.json", { access: "private", useCache: false });
    if (probe?.statusCode !== 200) throw new Error("Source settings are unavailable; refusing an empty backup");
    await new Response(probe.stream).arrayBuffer();
    async function inventory() {
      const files: { pathname: string; size: number; uploadedAt: Date }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: "secondbrain/", limit: 100, cursor });
        files.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return files.sort((a, b) => a.pathname.localeCompare(b.pathname));
    }
    const files = await inventory();
    for (const file of files) {
        const response = await get(file.pathname, { access: "private", useCache: false });
        if (response?.statusCode !== 200) throw new Error("A source record is blocked; no complete backup was created");
        const bytes = Buffer.from(await new Response(response.stream).arrayBuffer());
        if (bytes.length !== file.size) throw new Error("Source changed during backup");
        await save(file.pathname, bytes);
    }
    const stamp = (rows: typeof files) => JSON.stringify(rows.map(r => [r.pathname, r.size, r.uploadedAt]));
    if (stamp(await inventory()) !== stamp(files)) throw new Error("Workspace changed during backup; retry when writes are quiet");
  } else throw new Error("Set BRAIN_BACKUP_BACKEND to blob or supabase; no silent fallback is allowed");
  if (!recoverySnapshot) {
    for (const required of ["settings.json", "brains.json", "corpus.json", "brains/a2f66ffe-ae02-40eb-a264-a5697dcb6c5b/corpus.json", "brains/a2f66ffe-ae02-40eb-a264-a5697dcb6c5b/knowledge/jobs/03478f99-4e19-4fa9-a376-899ec53f657c.json"]) {
      if (!entries.some(e => e.name === `cloud/secondbrain/${required}`)) throw new Error("The snapshot lacks an expected live-workspace record");
    }
  }
  return entries;
}
async function main() {
  const [mode, directoryArgument, tagArgument] = process.argv.slice(2);
  if (mode === "local" || mode === "cloud" || mode === "seed" || mode === "recovery-snapshot") {
    const directory = directoryArgument ? path.resolve(directoryArgument) : path.join(root, `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const key = await recoveryKey(mode !== "cloud" && mode !== "recovery-snapshot");
    let entries = mode === "cloud" || mode === "recovery-snapshot" ? await cloudEntries(directory, mode === "recovery-snapshot") : await localEntries();
    if (mode === "seed") {
      const photos = entries.filter(entry => entry.name.startsWith("original-page-photographs/") && entry.name.endsWith(".jpg"));
      const plan = [];
      for (const photo of photos) plan.push({ name: photo.name, driveId: path.basename(photo.source, ".jpg"), bytes: (await stat(photo.source)).size, sha256: await fileHash(photo.source), mimeType: "image/jpeg" });
      const planPath = path.join(root, "recovery-source-plan.json");
      await mkdir(root, { recursive: true });
      await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
      entries = entries.filter(entry => !photos.includes(entry));
      entries.push({ source: planPath, name: "recovery-source-plan.json" });
    }
    console.log(JSON.stringify({ phase: "archiving", kind: mode, files: entries.length, directory, completeCloudState: mode === "cloud" }));
    const description = mode === "recovery-snapshot" ? "Current recovered Supabase workspace: all current JSON records and referenced originals. LEGACY VERCEL CLOUD STATE IS STILL INCOMPLETE: original saved drafts, accepted Astrology teachings, scan checkpoint and historical spending have not been recovered. Original page photos are in the separate source archive." : mode === "seed" ? "Encrypted seed for direct Drive-to-GitHub assembly. Original photographs are referenced by exact hashes but NOT included in this seed. NOT a complete workspace backup." : mode === "local" ? "Original source files, OCR, local Main corpus, and encrypted recovery configuration. NOT the current cloud drafts, Astrology nodes, or scan checkpoint." : "Complete retrieved live workspace records and uploaded originals; immutable page photos are in the separate source archive.";
    const details = { completeCloudState: mode === "cloud", description, ...(mode === "recovery-snapshot" ? { recoverySnapshot: { version: 1, backend: "supabase", currentSupabaseRecordsIncluded: true, pendingLegacyCloudRecovery: true } as RecoverySnapshotMetadata } : {}) };
    const manifest = await createBackup(entries, directory, key, details);
    console.log(JSON.stringify({ phase: "archive-created", directory, files: manifest.files, bytes: manifest.originalBytes, parts: manifest.parts.length, completeCloudState: manifest.completeCloudState, recoveryKeyFile: mode === "local" ? keyPath : "existing key" }));
  } else if (mode === "restore") {
    if (!directoryArgument || !tagArgument) throw new Error("Usage: restore ARCHIVE_DIRECTORY NEW_DESTINATION");
    const result = await restoreBackup(path.resolve(directoryArgument), path.resolve(tagArgument), await recoveryKey());
    console.log(JSON.stringify({ restored: true, ...result }));
  } else if (mode === "publish") {
    if (!directoryArgument || !tagArgument || !/^brain-backup-[a-zA-Z0-9-]+$/.test(tagArgument)) throw new Error("Usage: publish ARCHIVE_DIRECTORY brain-backup-TAG");
    const directory = path.resolve(directoryArgument), manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as PublishedManifest;
    for (const part of manifest.parts) if (!/^archive\.part-\d{3}\.bin$/.test(part.name) || await fileHash(path.join(directory, part.name)) !== part.sha256) throw new Error("Backup part verification failed before upload");
    if (manifest.recoverySnapshot) {
      const metadata = manifest.recoverySnapshot;
      if (manifest.completeCloudState !== false || metadata.version !== 1 || metadata.backend !== "supabase" || metadata.currentSupabaseRecordsIncluded !== true || metadata.pendingLegacyCloudRecovery !== true) throw new Error("Recovery snapshot metadata must preserve incomplete legacy cloud status");
      // A recovery publication always authenticates and restores EVERY byte
      // immediately before any GitHub mutation, including manual publications.
      const restored = `${directory}-publish-verified-${randomBytes(6).toString("hex")}`;
      const verified = await restoreBackup(directory, restored, await recoveryKey());
      if (verified.completeCloudState !== false) throw new Error("A recovery snapshot cannot claim complete legacy cloud state");
      const marker = JSON.parse(await readFile(path.join(restored, ".secondbrain-restore-verified.json"), "utf8")) as { files: { name: string }[] };
      const records: SupabaseRecord[] = [];
      for (const file of marker.files.filter(file => file.name.startsWith("cloud/secondbrain/") && file.name.endsWith(".json"))) records.push({ key: file.name.slice("cloud/".length), value: JSON.parse(await readFile(path.join(restored, ...file.name.split("/")), "utf8")), etag: "restored-file-verified" });
      validateRecoverySnapshot(records);
      const encryptedMetadata = JSON.parse(await readFile(path.join(restored, "snapshot-metadata/recovery-snapshot.json"), "utf8"));
      if (encryptedMetadata.version !== 1 || encryptedMetadata.scope !== "current-recovered-supabase-workspace" || encryptedMetadata.completeCloudState !== false || encryptedMetadata.pendingLegacyCloudRecovery !== true || encryptedMetadata.recoveryBrainId !== recoveryBrainId || encryptedMetadata.records !== records.length) throw new Error("Encrypted recovery provenance does not match the snapshot");
    }
    const notes = `Encrypted Secondbrain recovery archive.\n\nFiles: ${manifest.files}. Original bytes: ${manifest.originalBytes}. Complete cloud state: ${manifest.completeCloudState}.\n\n${manifest.description}\n\nUse scripts/brain-backup.ts restore with the separate recovery key. The key and plaintext secrets are NOT release assets. No AI calls are needed to restore. Download every archive.part file and manifest.json. Never overwrite a live workspace before verifying the restore.\n`;
    // Drafts have no published tag yet; the by-tag endpoint can return 404.
    // Discover owned drafts through the authenticated releases listing instead.
    type Release = { id: number; tag_name: string; draft: boolean; assets: { name: string; size: number; digest: string }[] };
    const releases = JSON.parse(await command(["api", `repos/${repository}/releases?per_page=100`])) as Release[];
    let previous = releases.find(release => release.tag_name === tagArgument);
    if (previous && !previous.draft) throw new Error("Release is already published; use a new tag rather than overwriting a recovery snapshot");
    if (!previous) await command(["release", "create", tagArgument, "--repo", repository, "--draft", "--prerelease", "--latest=false", "--target", "main", "--title", manifest.recoverySnapshot ? "Brain backup — recovered Supabase (legacy cloud incomplete)" : manifest.completeCloudState ? "Brain backup — complete cloud state" : "Brain backup — original sources (cloud state still missing)", "--notes-file", "-"], notes);
    for (const file of [...manifest.parts.map(p => p.name), "manifest.json"]) {
      const existing = previous?.assets.find(asset => asset.name === file);
      if (existing) {
        if (existing.size !== (await stat(path.join(directory, file))).size || existing.digest !== `sha256:${await fileHash(path.join(directory, file))}`) throw new Error("Existing draft asset differs; refusing to overwrite it");
        console.log(JSON.stringify({ phase: "already-uploaded-and-verified", asset: file })); continue;
      }
      console.log(JSON.stringify({ phase: "uploading", asset: file }));
      await command(["release", "upload", tagArgument, path.join(directory, file), "--repo", repository]);
    }
    if (!previous) {
      const releases = JSON.parse(await command(["api", `repos/${repository}/releases?per_page=100`])) as Release[];
      previous = releases.find(release => release.tag_name === tagArgument);
    }
    if (!previous) throw new Error("Uploaded draft release could not be found");
    const assets = JSON.parse(await command(["api", `repos/${repository}/releases/${previous.id}`, "--jq", ".assets"]));
    for (const part of manifest.parts) {
      const remote = assets.find((asset: { name: string }) => asset.name === part.name);
      if (!remote || remote.size !== part.bytes || remote.digest !== `sha256:${part.sha256}`) throw new Error("GitHub asset size/hash mismatch; release left as a draft");
    }
    const manifestAsset = assets.find((asset: { name: string }) => asset.name === "manifest.json");
    if (manifestAsset?.digest !== `sha256:${await fileHash(path.join(directory, "manifest.json"))}`) throw new Error("GitHub manifest hash mismatch; release left as a draft");
    await command(["release", "edit", tagArgument, "--repo", repository, "--draft=false", "--latest=false"]);
    console.log(JSON.stringify({ published: true, url: `https://github.com/${repository}/releases/tag/${tagArgument}`, completeCloudState: manifest.completeCloudState }));
  } else if (mode === "activate-daily" || mode === "activate-recovery-daily") {
    const backend = process.env.BRAIN_BACKUP_BACKEND;
    if (!["blob", "supabase"].includes(backend || "")) throw new Error("Explicitly select the recovered live backend before activation");
    const recovery = mode === "activate-recovery-daily";
    if (recovery && backend !== "supabase") throw new Error("Recovery daily backups require the dedicated Supabase backend");
    const tag = `brain-backup-${recovery ? "recovery" : "cloud"}-${new Date().toISOString().replace(/[^0-9]/g, "")}`;
    const directory = path.join(root, tag);
    const script = path.resolve("scripts/brain-backup.ts");
    await command(["--import", "tsx", script, recovery ? "recovery-snapshot" : "cloud", directory], undefined, process.execPath);
    await command(["--import", "tsx", script, "restore", directory, `${directory}-verified`], undefined, process.execPath);
    await command(["--import", "tsx", script, "publish", directory, tag], undefined, process.execPath);
    // These are deliberately last: a failed or empty snapshot never activates
    // a misleading automatic backup schedule.
    await command(["variable", "set", "BRAIN_BACKUP_ENABLED", "--repo", repository, "--body", "false"]);
    await command(["variable", "set", "BRAIN_BACKUP_BACKEND", "--repo", repository, "--body", backend!]);
    await command(["variable", "set", "BRAIN_BACKUP_MODE", "--repo", repository, "--body", recovery ? "recovery" : "complete"]);
    await command(["variable", "set", "BRAIN_BACKUP_ENABLED", "--repo", repository, "--body", "true"]);
    console.log(JSON.stringify({ dailyBackupsEnabled: true, backupMode: recovery ? "recovery" : "complete", completeCloudState: !recovery, ...(recovery ? { firstRecoverySnapshot: `https://github.com/${repository}/releases/tag/${tag}`, pendingLegacyCloudRecovery: true } : { firstCompleteSnapshot: `https://github.com/${repository}/releases/tag/${tag}` }) }));
  } else if (mode === "install-secrets") {
    const key = await recoveryKey();
    await command(["secret", "set", "BRAIN_BACKUP_KEY", "--repo", repository], key.toString("base64url"));
    for (const name of ["BLOB_READ_WRITE_TOKEN", "BRAIN_SUPABASE_GATEWAY_TOKEN", "BRAIN_SUPABASE_URL"]) if (process.env[name]) await command(["secret", "set", name, "--repo", repository], process.env[name]);
    console.log(JSON.stringify({ repositorySecretsStored: true, plaintextPublished: false }));
  } else throw new Error("Choose local, seed, cloud, recovery-snapshot, restore, publish, activate-daily, activate-recovery-daily, or install-secrets");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Backup failed; no complete snapshot was published"); process.exitCode = 1; });
