import "server-only";
import { randomUUID } from "node:crypto";
import type { Brain } from "./types";
import { readRecord, updateRecord } from "./storage";
import { HttpError } from "./auth";
import { MAIN_BRAIN_ID, validBrainId } from "./brain-scope";

export const MAIN_BRAIN: Brain = { id: MAIN_BRAIN_ID, name: "Main brain", description: "Your original shared knowledge library.", createdAt: "", createdBy: "Alex" };
export async function listBrains(): Promise<Brain[]> {
  const record = await readRecord<Brain[]>("brains.json");
  return [MAIN_BRAIN, ...(record?.value ?? []).filter(b => b.id !== MAIN_BRAIN_ID)];
}
export async function requireBrain(id: string): Promise<Brain> {
  if (!validBrainId(id)) throw new HttpError(400, "Choose a valid brain.");
  const brain = (await listBrains()).find(b => b.id === id);
  if (!brain) throw new HttpError(404, "This brain does not exist. Choose a brain from the switcher.");
  return brain;
}
export async function createBrain(name: string, description: string, author: string): Promise<Brain> {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 60 || description.length > 240) throw new HttpError(400, "Use a brain name up to 60 characters and a description up to 240 characters.");
  const brain: Brain = { id: randomUUID(), name: normalized, description: description.trim(), createdAt: new Date().toISOString(), createdBy: author };
  await updateRecord<Brain[]>("brains.json", [MAIN_BRAIN], old => {
    const brains = [MAIN_BRAIN, ...old.filter(b => b.id !== MAIN_BRAIN_ID)];
    if (brains.length >= 50) throw new HttpError(400, "This workspace supports up to 50 separate brains.");
    if (brains.some(b => b.name.toLowerCase() === normalized.toLowerCase())) throw new HttpError(409, "A brain with this name already exists. Choose it in the switcher or use a different name.");
    return [...brains, brain];
  });
  return brain;
}
