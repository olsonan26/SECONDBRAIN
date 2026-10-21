import type { Citation } from "./types";
export interface Evidence { citation: number; quote?: string; imageId?: string; visualObservation?: string }
export interface ModelParagraph { text: string; citations: number[]; evidence: Evidence[] }
export interface GroundedOutput { title?: string; paragraphs: ModelParagraph[]; gaps?: string }
export interface SupportCheck { index: number; supported: boolean; reason?: string }
export function allParagraphsSupported(checks: unknown, count: number): boolean {
  if (!Array.isArray(checks) || checks.length !== count || count === 0) return false;
  const seen = new Set<number>();
  return checks.every((check: SupportCheck) => typeof check.index === "number" && Number.isInteger(check.index) && check.index >= 0 && check.index < count && !seen.has(check.index) && Boolean(seen.add(check.index)) && check.supported === true);
}

/** Checks traceability, not semantic truth: source passages remain visible for review. */
export function validateGroundedOutput(output: GroundedOutput, citations: Citation[]): boolean {
  if (!Array.isArray(output.paragraphs) || !output.paragraphs.length || output.paragraphs.length > 30) return false;
  return output.paragraphs.every(p => typeof p.text === "string" && p.text.length > 0 && p.text.length < 5000 &&
    Array.isArray(p.citations) && p.citations.length > 0 && p.citations.every(n => citations.some(c => c.number === n)) &&
    Array.isArray(p.evidence) && p.citations.every(n => p.evidence.some(e => {
      if (e.citation !== n) return false;
      const citation = citations.find(c => c.number === n)!;
      if (citation.image && (!e.imageId || !e.visualObservation)) return false;
      if (e.imageId) return citation.image?.id === e.imageId && typeof e.visualObservation === "string" && e.visualObservation.trim().length >= 20;
      return typeof e.quote === "string" && e.quote.length >= 12 && citation.text.replace(/\s+/g, " ").includes(e.quote.replace(/\s+/g, " "));
    })));
}
