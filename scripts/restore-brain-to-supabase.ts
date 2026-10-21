import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileHash, validBackupPath } from "./backup-format";
import { supabaseRead, supabaseWrite, supabaseReadOriginal, supabaseWriteOriginal } from "../src/lib/supabase-storage";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}` : JSON.stringify(value);

async function main() {
  const [argument, apply] = process.argv.slice(2);
  if (!argument) throw new Error("Usage: restore-brain-to-supabase.ts VERIFIED_RESTORE_DIRECTORY [--apply]");
  if (apply && apply !== "--apply") throw new Error("Unknown restore option");
  const root = path.resolve(argument);
  const marker = JSON.parse(await readFile(path.join(root, ".secondbrain-restore-verified.json"), "utf8")) as { version: number; completeCloudState: boolean; files: { name: string; bytes: number; sha256: string }[] };
  if (marker.version !== 1 || marker.completeCloudState !== true || !Array.isArray(marker.files) || !marker.files.length) throw new Error("This is not a verified COMPLETE cloud snapshot. Source-only archives cannot replace your live workspace.");
  const files = marker.files.filter(file => file.name.startsWith("cloud/secondbrain/"));
  const seen = new Set<string>();
  for (const file of files) {
    if (!validBackupPath(file.name) || seen.has(file.name)) throw new Error("Invalid restored storage path");
    seen.add(file.name);
    const source = path.join(root, ...file.name.split("/"));
    if ((await stat(source)).size !== file.bytes || await fileHash(source) !== file.sha256) throw new Error("Restored file changed after its integrity check; import stopped");
  }
  for (const required of ["settings.json", "brains.json", "corpus.json"]) if (!seen.has(`cloud/secondbrain/${required}`)) throw new Error("Snapshot is missing required workspace records");
  if (apply !== "--apply") {
    console.log(JSON.stringify({ verified: true, files: files.length, writes: 0, next: "Repeat with --apply only against the intended destination. Preserve the original session secret and account configuration." })); return;
  }
  // Create-only import. Resume accepts identical existing values but never
  // replaces differing nodes, jobs, cost ledgers, settings or original files.
  let imported = 0;
  for (const file of files) {
    const key = file.name.slice("cloud/".length), bytes = await readFile(path.join(root, ...file.name.split("/")));
    if (key.endsWith(".json")) {
      const value = JSON.parse(bytes.toString("utf8")), old = await supabaseRead(key);
      if (old && digest(canonical(old.value)) !== digest(canonical(value))) throw new Error(`Destination differs at ${key}; nothing was overwritten`);
      if (!old) await supabaseWrite(key, value, null);
      const saved = await supabaseRead(key);
      if (!saved || digest(canonical(saved.value)) !== digest(canonical(value))) throw new Error("Destination verification failed");
    } else {
      const old = await supabaseReadOriginal(key);
      if (old && digest(new Uint8Array(await new Response(old).arrayBuffer())) !== file.sha256) throw new Error("Destination original differs; nothing was overwritten");
      if (!old) await supabaseWriteOriginal(key, bytes);
      const saved = await supabaseReadOriginal(key);
      if (!saved || digest(new Uint8Array(await new Response(saved).arrayBuffer())) !== file.sha256) throw new Error("Destination original verification failed");
    }
    imported++;
  }
  console.log(JSON.stringify({ imported, verified: true, overwritten: 0, checkpointResets: 0, budgetResets: 0, productionSwitched: false }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Restore stopped safely"); process.exitCode = 1; });
