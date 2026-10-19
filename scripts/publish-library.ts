import { get, put } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
  throw new Error("Connect the private Vercel Blob store and pull its environment before publishing the library.");
}
const text = await readFile("private/corpus.json", "utf8");
const corpus = JSON.parse(text);
if (!Array.isArray(corpus.sources) || !Array.isArray(corpus.passages) || !corpus.sources.length) throw new Error("Private corpus is missing or invalid.");
const current = await get("secondbrain/corpus.json", { access: "private", useCache: false });
if (current?.statusCode === 200) {
  const previous = await new Response(current.stream).text();
  if (createHash("sha256").update(previous).digest("hex") === createHash("sha256").update(text).digest("hex")) {
    console.log(`Private library already matches: ${corpus.sources.length} sources, ${corpus.passages.length} passages.`);
    process.exit(0);
  }
  throw new Error("A different library already exists in cloud storage. Refusing to replace shared changes automatically.");
}
await put("secondbrain/corpus.json", text, { access: "private", addRandomSuffix: false, contentType: "application/json" });
const verify = await get("secondbrain/corpus.json", { access: "private", useCache: false });
if (verify?.statusCode !== 200) throw new Error("Private upload could not be read back.");
const roundtrip = await new Response(verify.stream).text();
if (createHash("sha256").update(roundtrip).digest("hex") !== createHash("sha256").update(text).digest("hex")) throw new Error("Private upload verification failed.");
console.log(`Private library published and verified: ${corpus.sources.length} sources, ${corpus.passages.length} passages. No public URL was created.`);
