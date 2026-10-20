import test from "node:test";
import assert from "node:assert/strict";
import { MAX_EXTRACTED_CHARACTERS, MAX_UPLOAD_BYTES, uploadValidationError } from "../src/lib/import-limits";

test("upload validation gives immediate actionable errors before a network request", () => {
  assert.equal(uploadValidationError({ name: "Book.PDF", size: 1_375_464 }), null);
  assert.equal(uploadValidationError({ name: "Notes.markdown", size: 100 }), null);
  assert.equal(uploadValidationError({ name: "Book.pdf", size: MAX_UPLOAD_BYTES }), null);
  assert.match(uploadValidationError({ name: "Book.pdf", size: MAX_UPLOAD_BYTES + 1 })!, /over 4 MB/);
  assert.match(uploadValidationError({ name: "Empty.pdf", size: 0 })!, /empty/);
  assert.match(uploadValidationError({ name: "Book.exe", size: 100 })!, /Choose a PDF/);
  assert.equal(MAX_EXTRACTED_CHARACTERS, 5_000_000);
});
