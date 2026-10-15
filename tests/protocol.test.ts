import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../packages/protocol/src/index.js";
test("strict protocol rejects arbitrary paths and excessive reads", () => {
  assert.throws(() =>
    parseRequest({
      requestId: "a",
      type: "folder.add",
      payload: { path: "/etc" },
    }),
  );
  assert.throws(() =>
    parseRequest({
      requestId: "a",
      type: "file.read",
      payload: { fileId: "x", limitBytes: 1e9 },
    }),
  );
  assert.equal(
    parseRequest({ requestId: "a", type: "folder.list", payload: {} }).type,
    "folder.list",
  );
});

test("response schema rejects oversized or malformed agent payloads", async () => {
  const { response } = await import("../packages/protocol/src/index.js");
  assert.throws(() =>
    response.parse({
      requestId: "a",
      type: "result",
      payload: { content: "unbounded" },
    }),
  );
  assert.throws(() =>
    response.parse({
      requestId: "a",
      type: "error",
      payload: { error: "x".repeat(1025) },
    }),
  );
});
