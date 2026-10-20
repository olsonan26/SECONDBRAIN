// Keep multipart uploads below the hosting request limit. Extracted text can be
// larger than the compressed PDF; this separate cap supports full-length books.
export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_EXTRACTED_CHARACTERS = 5_000_000;
export function uploadValidationError(file: { name: string; size: number }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return "This file is over 4 MB. Split it into smaller files before importing.";
  if (!/\.(pdf|docx|txt|md|markdown|json)$/i.test(file.name)) return "Choose a PDF, Word .docx, text, Markdown, or Graphify JSON file.";
  if (!file.size) return "This file is empty. Choose a file with content to import.";
  return null;
}
