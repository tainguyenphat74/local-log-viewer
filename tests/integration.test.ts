import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { once } from "node:events";
import { createGateway } from "../apps/gateway/src/server.js";
import { startAgent } from "../apps/agent/src/runtime.js";
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(fn());
};
test("actual gateway and agent: auth, pairing, routing, browse/read/search/watch/reconnect/revoke", async () => {
  const dir = await mkdtemp(tmpdir() + "/logview-");
  const port = 19000 + Math.floor(Math.random() * 10000);
  const origin = "http://127.0.0.1:" + port;
  const g = await createGateway({
    password: "integration-password",
    statePath: dir + "/state",
    origin,
  });
  g.server.listen(port, "127.0.0.1");
  await once(g.server, "listening");
  let agent: ReturnType<typeof startAgent> | undefined;
  const sockets: WebSocket[] = [];
  try {
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(origin + path, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal((await request("/api/agents")).status, 401);
    assert.equal(
      (
        await request(
          "/api/login",
          "POST",
          { password: "integration-password" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    const login = await request(
      "/api/login",
      "POST",
      { password: "integration-password" },
      { Origin: origin },
    );
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { csrf } = (await login.json()) as any;
    const headers = { Cookie: cookie, Origin: origin, "X-CSRF-Token": csrf };
    assert.equal(
      (
        await request(
          "/api/pairings",
          "POST",
          {},
          { Cookie: cookie, Origin: origin },
        )
      ).status,
      403,
    );
    const { code } = (await (
      await request("/api/pairings", "POST", {}, headers)
    ).json()) as any;
    const claim = await request("/api/pairings/claim", "POST", {
      code,
      name: "fixture",
    });
    const credentials = (await claim.json()) as any;
    assert.equal(
      (await request("/api/pairings/claim", "POST", { code, name: "again" }))
        .status,
      400,
    );
    await writeFile(dir + "/fixture.log", "INFO café\nERROR example\n");
    agent = startAgent({
      roots: [{ id: "root", name: "Fixture", path: dir }],
      gateway: origin,
      ...credentials,
    });
    await wait(() => g.agents.has(credentials.agentId));
    const browser = async () => {
      const ws = new WebSocket(origin.replace("http", "ws") + "/ws/browser", {
        headers: { Cookie: cookie, Origin: origin },
      });
      sockets.push(ws);
      await once(ws, "open");
      return ws;
    };
    const a = await browser(),
      b = await browser();
    const receivedA: any[] = [],
      receivedB: any[] = [];
    a.on("message", (v) => receivedA.push(JSON.parse(v.toString())));
    b.on("message", (v) => receivedB.push(JSON.parse(v.toString())));
    let seq = 0;
    const rpc = async (
      ws: WebSocket,
      type: string,
      payload: unknown,
      id = String(++seq),
    ) => {
      const list = ws === a ? receivedA : receivedB;
      ws.send(
        JSON.stringify({
          agentId: credentials.agentId,
          request: { requestId: id, type, payload },
        }),
      );
      await wait(() => list.some((x) => x.requestId === id));
      const r = list.find((x) => x.requestId === id);
      if (r.type === "error") throw Error(r.payload.error);
      return r.payload;
    };
    await Promise.all([
      rpc(a, "folder.list", {}, "same"),
      rpc(b, "folder.list", {}, "same"),
    ]);
    assert.equal(receivedA.filter((v) => v.requestId === "same").length, 1);
    assert.equal(receivedB.filter((v) => v.requestId === "same").length, 1);
    const entries = await rpc(a, "file.list", { rootId: "root" });
    const fileId = entries.find((e: any) => e.name === "fixture.log").id;
    assert.match((await rpc(a, "file.read", { fileId })).content, /café/);
    assert.equal(
      (await rpc(a, "file.search", { fileId, query: "ERROR" })).results[0]
        .offset,
      11,
    );
    await assert.rejects(rpc(a, "file.read", { fileId: "../../etc/passwd" }));
    await rpc(a, "file.watch.start", { fileId }, "watch");
    await wait(() => receivedA.some((v) => v.type === "changed"));
    await appendFile(dir + "/fixture.log", "WARN appended\n");
    await wait(() =>
      receivedA.some(
        (v) => v.type === "changed" && v.payload.content.includes("appended"),
      ),
    );
    const old = agent.socket;
    old?.terminate();
    await wait(
      () =>
        agent!.socket !== old &&
        g.agents.get(credentials.agentId)?.readyState === WebSocket.OPEN,
    );
    await wait(() =>
      receivedA.some((v) => v.requestId === "watch" && v.type === "error"),
    );
    await rpc(a, "file.watch.start", { fileId }, "restored");
    await wait(() =>
      receivedA.some((v) => v.requestId === "restored" && v.type === "changed"),
    );
    const pending = once(agent.socket!, "close");
    assert.equal(
      (
        await request(
          "/api/agents/" + credentials.agentId,
          "DELETE",
          undefined,
          headers,
        )
      ).status,
      200,
    );
    await pending;
    assert.equal(
      g.auth.agent(
        "Bearer " + credentials.agentId + ":" + credentials.credential,
      ),
      undefined,
    );
  } finally {
    agent?.stop();
    for (const s of sockets) s.terminate();
    await g.close();
    await rm(dir, { recursive: true, force: true });
  }
});
