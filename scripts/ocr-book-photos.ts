import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

async function main() {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const limit = args.includes("--all") ? Infinity : Number(limitIndex >= 0 ? args[limitIndex + 1] : 3);
  if (!(limit > 0)) throw new Error("Use --limit N or --all.");
  const inventory = JSON.parse(await readFile("private/astrology-source-inventory.json", "utf8"));
  const images = inventory.images as { id: string; name: string; batch: string; bytes: number; url: string }[];
  const selected = [...images].sort((a, b) => Number(b.batch === "ROOT") - Number(a.batch === "ROOT") || a.name.localeCompare(b.name)).slice(0, limit);
  const root = resolve("private/astrology-photos");
  await mkdir(root, { recursive: true });
  let cursor = 0, complete = 0, failed = 0;
  async function worker() {
    while (cursor < selected.length) {
      const item = selected[cursor++];
      const path = resolve(root, `${item.id}.jpg`), output = resolve(root, `${item.id}.ocr.json`);
      try {
        try { await stat(output); complete++; continue; } catch { /* resumable */ }
        let bytes: Buffer;
        try { bytes = await readFile(path); }
        catch {
          const response = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(item.id)}`, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(`Image download returned ${response.status}, not image bytes.`);
          bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length !== item.bytes) throw new Error("Image size differs from the inventoried original; not accepted.");
          await writeFile(path, bytes);
        }
        const raw = await new Promise<string>((accept, reject) => {
          const child = spawn("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/ocr-book-photo.ps1"), "-Path", path], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
          let stdout = "", stderr = "";
          child.stdout.on("data", data => stdout += data);
          child.stderr.on("data", data => stderr += data);
          child.on("error", reject);
          child.on("close", code => code === 0 ? accept(stdout) : reject(new Error(stderr.slice(0, 800))));
        });
        const ocr = JSON.parse(raw.replace(/^\uFEFF/, ""));
        const result = { ...item, sha256: createHash("sha256").update(bytes).digest("hex"), ocr, printedPageCandidates: ocr.lines.flatMap((line: { text: string; words: { y: number }[] }) => {
          if (!line.words.some(word => word.y < ocr.height * .16 || word.y > ocr.height * .9)) return [];
          return [...line.text.matchAll(/\b(\d{1,4})\b/g)].map((match: RegExpMatchArray) => ({ number: Number(match[1]), line: line.text, verified: false }));
        }) };
        await writeFile(output, JSON.stringify(result));
        complete++;
        console.log(JSON.stringify({ event: "photo-ocr", complete, total: selected.length, id: item.id, batch: item.batch, candidates: result.printedPageCandidates }));
      } catch (error) { failed++; console.error(JSON.stringify({ event: "photo-error", id: item.id, message: error instanceof Error ? error.message : "OCR failed" })); }
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  console.log(JSON.stringify({ event: "finished", complete, failed, selected: selected.length, paidCalls: 0 }));
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Photo OCR failed"); process.exitCode = 1; });
