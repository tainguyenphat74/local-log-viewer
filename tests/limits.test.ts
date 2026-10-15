import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGateway } from "../apps/gateway/src/server.js";
import { MAX_FRAME } from "../packages/protocol/src/index.js";
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 300 && !fn(); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(fn());
};
test("gateway rejects wrong origins, cross-agent replies, excess requests and oversized frames", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-");
  const port = 30000 + Math.floor(Math.random() * 10000),
    origin = "http://127.0.0.1:" + port;
  const g = await createGateway({
    password: "limits-test-password",
    statePath: dir + "/state",
    origin,
  });
  g.server.listen(port, "127.0.0.1");
  await once(g.server, "listening");
  const sockets: WebSocket[] = [];
  try {
    const s = g.auth.login("limits-test-password"),
      cookie = "logview=" + s.id;
    const bad = new WebSocket(origin.replace("http", "ws") + "/ws/browser", {
      headers: { Cookie: cookie, Origin: "https://evil.example" },
    });
    bad.on("error", () => {});
    const denied = await once(bad, "unexpected-response");
    assert.equal((denied[1] as any).statusCode, 401);
    bad.terminate();
    const connect = async (path: string, headers: Record<string, string>) => {
      const ws = new WebSocket(origin.replace("http", "ws") + path, {
        headers,
      });
      ws.on("error", () => {});
      sockets.push(ws);
      await once(ws, "open");
      return ws;
    };
    const c1 = await g.auth.claim(g.auth.pairing(), "one"),
      c2 = await g.auth.claim(g.auth.pairing(), "two");
    const one = await connect("/ws/agent", {
      Authorization: "Bearer " + c1.agentId + ":" + c1.credential,
    });
    const two = await connect("/ws/agent", {
      Authorization: "Bearer " + c2.agentId + ":" + c2.credential,
    });
    const browser = await connect("/ws/browser", {
      Cookie: cookie,
      Origin: origin,
    });
    const requests: any[] = [],
      replies: any[] = [];
    one.on("message", (b) => requests.push(JSON.parse(b.toString())));
    browser.on("message", (b) => replies.push(JSON.parse(b.toString())));
    const request = (id: string, type = "folder.list", payload = {}) =>
      browser.send(
        JSON.stringify({
          agentId: c1.agentId,
          request: { requestId: id, type, payload },
        }),
      );
    request("private");
    await wait(() => requests.length === 1);
    two.send(
      JSON.stringify({
        requestId: requests[0].requestId,
        type: "result",
        payload: [{ id: "evil", name: "Injected" }],
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(replies.length, 0);
    one.send(
      JSON.stringify({
        requestId: requests[0].requestId,
        type: "result",
        payload: [],
      }),
    );
    await wait(() => replies.length === 1);
    assert.equal(replies[0].requestId, "private");
    for (let i = 0; i < 13; i++) request("pending" + i);
    await wait(() =>
      replies.some(
        (r) => r.type === "error" && r.payload.error === "Concurrency limit",
      ),
    );
    request("cancel", "cancel", { target: "pending0" } as any);
    await wait(() => requests.some((r) => r.type === "cancel"));
    const closed = once(browser, "close");
    browser.send("x".repeat(MAX_FRAME + 1));
    assert.equal((await closed)[0], 1009);
  } finally {
    for (const ws of sockets) ws.terminate();
    await g.close();
    await rm(dir, { recursive: true, force: true });
  }
});
