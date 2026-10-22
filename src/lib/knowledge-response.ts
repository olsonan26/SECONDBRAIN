import { z } from "zod";
import { extractionSchema, reviewSchema, finalVerificationSchema, type Extraction, type KnowledgeReview, type FinalVerification } from "./knowledge-schema";
import { substantiveTeachingClasses } from "./knowledge-usefulness";

type Phase = "extract" | "review" | "verify";
export type ValidationHold = { phase: Phase; path: string; issues: string[]; passageIds: string[]; teachingKey?: string };
type EntrySpec = { schema: z.ZodType; max: number; optional?: boolean };
type Context = { passageIds: string[]; candidate?: Extraction; review?: KnowledgeReview };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const specs: Record<Phase, Record<string, EntrySpec>> = {
  extract: {
    teachings: { schema: extractionSchema.shape.teachings.element, max: 150 },
    relationships: { schema: extractionSchema.shape.relationships.unwrap().element, max: 200, optional: true },
    passages: { schema: extractionSchema.shape.passages.element, max: 30 },
    gaps: { schema: extractionSchema.shape.gaps.unwrap().element, max: 40, optional: true },
    clarifications: { schema: extractionSchema.shape.clarifications.unwrap().element, max: 3, optional: true },
  },
  review: {
    checks: { schema: reviewSchema.shape.checks.element, max: 150 },
    additions: { schema: reviewSchema.shape.additions.unwrap().element, max: 150, optional: true },
    relationships: { schema: reviewSchema.shape.relationships.unwrap().element, max: 200, optional: true },
    passages: { schema: reviewSchema.shape.passages.element, max: 30 },
    gaps: { schema: reviewSchema.shape.gaps.unwrap().element, max: 40, optional: true },
    clarifications: { schema: reviewSchema.shape.clarifications.unwrap().element, max: 3, optional: true },
  },
  verify: {
    teachings: { schema: finalVerificationSchema.shape.teachings.element, max: 300 },
    relationships: { schema: finalVerificationSchema.shape.relationships.element, max: 200 },
    passages: { schema: finalVerificationSchema.shape.passages.element, max: 30 },
    gaps: { schema: finalVerificationSchema.shape.gaps.unwrap().element, max: 40, optional: true },
  },
};

// Only canonical spelling is repaired. Unknown categories are NEVER inferred
// from a label, technical statement, another model result or general knowledge.
function choice(value: unknown, allowed: readonly string[]) {
  if (typeof value !== "string") return value;
  const canonical = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return allowed.includes(canonical) ? canonical : value;
}
function normalize(value: unknown, field: string, phase: Phase): unknown {
  const item = record(value);
  if (!item) return value;
  if ((phase === "extract" && field === "teachings") || (phase === "review" && field === "additions")) {
    return { ...item, kind: choice(item.kind, ["definition", "interpretation", "procedure", "formula", "rule", "distinction", "example", "warning", "correspondence"]) };
  }
  const usefulness = record(item.usefulness);
  if (phase === "verify" && field === "teachings" && usefulness && "teachingClass" in usefulness) return { ...item, usefulness: { ...usefulness, teachingClass: choice(usefulness.teachingClass, substantiveTeachingClasses) } };
  return value;
}
function affected(value: unknown, context: Context): string[] {
  const item = record(value);
  if (!item) return context.passageIds;
  const proposals = [...(context.candidate?.teachings ?? []), ...(context.review?.additions ?? [])];
  const ids: unknown[] = [item.passageId];
  if (Array.isArray(item.evidence)) ids.push(...item.evidence.map(e => record(e)?.passageId));
  if (typeof item.key === "string") ids.push(...proposals.filter(t => t.key === item.key).flatMap(t => t.evidence.map(e => e.passageId)));
  if (Number.isInteger(item.index)) ids.push(...(context.review?.relationships[item.index as number]?.evidence.map(e => e.passageId) ?? []));
  const known = context.passageIds.filter(id => ids.includes(id));
  return known.length ? known : context.passageIds;
}

export function parseKnowledgeResponse(phase: "extract", input: unknown, context: Context): { value: Extraction; holds: ValidationHold[] };
export function parseKnowledgeResponse(phase: "review", input: unknown, context: Context): { value: KnowledgeReview; holds: ValidationHold[] };
export function parseKnowledgeResponse(phase: "verify", input: unknown, context: Context): { value: FinalVerification; holds: ValidationHold[] };
export function parseKnowledgeResponse(phase: Phase, input: unknown, context: Context) {
  const fields = specs[phase];
  const shape: Record<string, z.ZodType> = {};
  for (const [field, spec] of Object.entries(fields)) {
    const list = z.array(z.unknown()).max(spec.max);
    shape[field] = spec.optional ? list.default([]) : list;
  }
  if (phase === "review") shape.reviewComplete = z.boolean();
  // Validate the envelope first: missing arrays, wrong types, excessive counts,
  // incomplete review flags and malformed top-level data still fail closed.
  const envelope = z.object(shape).parse(input);
  const output: Record<string, unknown> = { ...envelope };
  const holds: ValidationHold[] = [];
  for (const [field, spec] of Object.entries(fields)) {
    output[field] = (envelope[field] as unknown[]).flatMap((raw, index) => {
      const parsed = spec.schema.safeParse(normalize(raw, field, phase));
      if (parsed.success) return [parsed.data];
      const item = record(raw);
      holds.push({ phase, path: `${field}.${index}`, issues: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`), passageIds: affected(raw, context),
        ...(["teachings", "additions", "checks"].includes(field) && typeof item?.key === "string" ? { teachingKey: item.key } : {}) });
      return [];
    });
  }
  // If one duplicate check was malformed, removing it must not turn the other
  // check into an apparent exact-once approval. Keep the whole identity held.
  const heldKeys = new Set(holds.flatMap(hold => hold.teachingKey ? [hold.teachingKey] : []));
  for (const field of ["teachings", "additions", "checks"]) if (Array.isArray(output[field])) output[field] = (output[field] as unknown[]).filter(item => !heldKeys.has(String(record(item)?.key)));
  if (phase === "verify") {
    const invalidIndices = new Set(holds.filter(hold => hold.path.startsWith("relationships.")).map(hold => record((envelope.relationships as unknown[])[Number(hold.path.split(".")[1])])?.index));
    output.relationships = (output.relationships as unknown[]).filter(item => !invalidIndices.has(record(item)?.index));
  }
  const schema = phase === "extract" ? extractionSchema : phase === "review" ? reviewSchema : finalVerificationSchema;
  return { value: schema.parse(output), holds };
}

export const responseFormatInstructions = "Response categories are separate fields: teaching.kind MUST be exactly definition, interpretation, procedure, formula, rule, distinction, example, warning, or correspondence. Final usefulness.teachingClass instead uses exactly technical-definition, symbolic-meaning, chart-structure, correspondence, interpretation-rule, calculation, reading-procedure, condition-or-exception, worked-example, or astronomical-foundation. Do not interchange these lists. For usefulness.decision=teaching supply a specific technicalStatement of at least 20 characters and a concrete applicationQuestion. Never fill these with placeholders. For nonteaching or uncertain decisions omit teachingClass and technicalStatement rather than inventing categories such as none or unknown.";
