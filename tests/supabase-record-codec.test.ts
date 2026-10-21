import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeSupabaseRecord, decodeSupabaseRecord } from "../src/lib/supabase-record-codec";

test("Postgres-safe records remain unchanged for backward compatibility", () => {
  const record = { text: "Aries \u2609 \ud83c\udf19", version: 1 };
  assert.equal(encodeSupabaseRecord(record), record);
  assert.equal(decodeSupabaseRecord(record), record);
});

test("NUL and isolated surrogates round-trip without changing a single source character or hash", () => {
  for (const text of ["before\u0000after", "\ud800", "\udfff", "literal \\u0000 remains literal"]) {
    const record = { source: { content: text }, passages: [{ text }] };
    const encoded = encodeSupabaseRecord(record);
    assert.notEqual(encoded, record);
    assert.ok(!/\\u0000|\\u[dD][89a-fA-F][0-9a-fA-F]{2}/.test(JSON.stringify(encoded)));
    const decoded = decodeSupabaseRecord<typeof record>(JSON.parse(JSON.stringify(encoded)));
    assert.deepEqual(decoded, record);
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    assert.equal(hash(decoded), hash(record));
  }
});

test("encoded record corruption and invalid reserved envelopes fail closed", () => {
  const encoded = encodeSupabaseRecord({ text: "\u0000" }) as Record<string, unknown>;
  assert.throws(() => decodeSupabaseRecord({ ...encoded, sha256: "0".repeat(64) }), /fingerprint/);
  assert.throws(() => decodeSupabaseRecord({ ...encoded, jsonBase64: "?" }), /encoding/);
  assert.throws(() => decodeSupabaseRecord({ ...encoded, extra: true }), /encoding/);
});
