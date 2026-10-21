import { createHash } from "node:crypto";
import type { Passage } from "./types";

const images = new Map<string, Uint8Array>();
let cacheBytes = 0;
export async function readPassageImage(passage: Passage): Promise<Uint8Array> {
  const photo = passage.image;
  if (!photo || !/^[A-Za-z0-9_-]{20,100}$/.test(photo.driveId) || !/^[a-f0-9]{64}$/.test(photo.sha256)) throw new Error("This passage has no valid original image reference.");
  const cached = images.get(photo.sha256);
  if (cached) return cached;
  const response = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(photo.driveId)}`, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error(`Original page image could not be read (${response.status}). No image knowledge was accepted.`);
  if (Number(response.headers.get("content-length")) > 12_000_000) throw new Error("Original page image exceeds the safe image-input limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 12_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || createHash("sha256").update(bytes).digest("hex") !== photo.sha256) throw new Error("Original page image did not match its inventoried JPEG fingerprint.");
  if (cacheBytes + bytes.length > 48_000_000) { images.clear(); cacheBytes = 0; }
  images.set(photo.sha256, bytes); cacheBytes += bytes.length;
  return bytes;
}

const capabilities = new Map<string, { context: number; at: number }>();
export async function imageContextCeiling(model: string): Promise<number> {
  const cached = capabilities.get(model);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.context;
  const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) throw new Error("Cannot verify image support and the model's context ceiling. No paid image call was started.");
  const catalogue = await response.json();
  const entry = catalogue.data?.find((entry: { id: string }) => entry.id === model);
  if (!entry?.architecture?.input_modalities?.includes("image")) throw new Error("The selected model is not listed as accepting images. Choose an image-capable model before scanning photographs.");
  const context = entry.context_length;
  if (!Number.isInteger(context) || context < 1000 || context > 4_000_000 || Number(entry.pricing?.image || 0) > 0) throw new Error("The image model's maximum token cost cannot be safely bounded by this spending guard.");
  capabilities.set(model, { context, at: Date.now() }); return context;
}

export async function imageMessages(messages: { role: string; content: string }[], passages: Passage[], maxImages = 1) {
  const photos = [...new Map(passages.filter(passage => passage.image).map(passage => [passage.image!.id, passage])).values()];
  if (!photos.length) return messages;
  if (photos.length > maxImages) throw new Error("Too many original images for one bounded model request.");
  const attachments = await Promise.all(photos.map(async passage => {
    const bytes = await readPassageImage(passage);
    return [
      { type: "text", text: `Original image ${passage.image!.id}, attached to target passage ${passage.id}. SHA256 ${passage.image!.sha256}. Inspect the actual page, not just OCR. Printed page labels and OCR are not interchangeable.` },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`, detail: "high" } },
    ];
  }));
  return [...messages.slice(0, -1), { role: "user", content: [
    { type: "text", text: messages[messages.length - 1].content },
    ...attachments.flat(),
  ] }];
}
