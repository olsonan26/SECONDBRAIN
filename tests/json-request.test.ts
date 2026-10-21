import test from "node:test";
import assert from "node:assert/strict";
import { jsonRequestInit, parseJsonRequest } from "../src/lib/json-request";

test("bodyless extraction POST sends a JSON object, but GET stays bodyless", async () => {
  const init = jsonRequestInit("POST");
  assert.equal(new Headers(init.headers).get("Content-Type"), "application/json");
  assert.deepEqual(await new Request("https://example.com/resume", init).json(), {});
  assert.equal(jsonRequestInit("GET").body, undefined);
  assert.equal(jsonRequestInit("GET").headers, undefined);
});

test("Resume accepts an empty body from an older browser without accepting malformed JSON", async () => {
  const request = (body?: string) => new Request("https://example.com/resume", { method: "POST", body });
  assert.deepEqual(await parseJsonRequest(request(), true), {});
  assert.deepEqual(await parseJsonRequest(request("  \n"), true), {});
  assert.deepEqual(await parseJsonRequest(request('{"budgetUsd":10}'), true), { budgetUsd: 10 });
  await assert.rejects(parseJsonRequest(request("{"), true), SyntaxError);
  await assert.rejects(parseJsonRequest(request()), SyntaxError);
});
