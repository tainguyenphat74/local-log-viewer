import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { Auth } from "./auth.js";
import {
  parseRequest,
  response,
  MAX_FRAME,
} from "../../../packages/protocol/src/index.js";
export function send(ws: WebSocket, value: unknown) {
  const data = JSON.stringify(value);
  if (ws.readyState !== WebSocket.OPEN) return;
  if (
    ws.bufferedAmount > 2 * MAX_FRAME ||
    Buffer.byteLength(data) > MAX_FRAME
  ) {
    ws.close(1009, "Backpressure limit");
    return;
  }
  ws.send(data);
}
export async function createGateway(options: {
  password: string;
  statePath: string;
  origin: string;
  webDir?: string;
}) {
  const auth = new Auth(options.password, options.statePath);
  await auth.load();
  const origin = new URL(options.origin);
  if (
    origin.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    throw Error("Remote origin requires HTTPS");
  const agents = new Map<string, WebSocket>(),
    browsers = new Set<WebSocket>();
  type Route = {
    browser: WebSocket;
    agent: WebSocket;
    clientId: string;
    agentId: string;
    watch: boolean;
    expires: number;
    fileId?: string;
  };
  const routes = new Map<string, Route>();
  function discard(key: string, r: Route) {
    routes.delete(key);
    send(r.agent, {
      requestId: randomUUID(),
      type: "cancel",
      payload: { target: key },
    });
  }
  async function body(req: IncomingMessage) {
    let raw = "";
    for await (const b of req) {
      raw += b;
      if (Buffer.byteLength(raw) > 8192) throw Error("Body too large");
    }
    return JSON.parse(raw || "{}");
  }
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const path = new URL(req.url || "/", origin).pathname;
      if (path === "/health") return json(200, { ok: true });
      if (path.startsWith("/api/")) {
        const mutating = req.method !== "GET";
        if (
          mutating &&
          path !== "/api/pairings/claim" &&
          req.headers.origin !== origin.origin
        )
          return json(403, { error: "Origin denied" });
        if (path === "/api/login" && req.method === "POST") {
          if (!auth.allow(req.socket.remoteAddress || ""))
            return json(429, { error: "Try again later" });
          const input = z
            .object({ password: z.string().max(1024) })
            .strict()
            .parse(await body(req));
          const s = auth.login(input.password);
          res.setHeader(
            "Set-Cookie",
            "logview=" +
              s.id +
              "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800" +
              (origin.protocol === "https:" ? "; Secure" : ""),
          );
          return json(200, { csrf: s.csrf });
        }
        if (path === "/api/pairings/claim" && req.method === "POST") {
          if (req.headers.origin) return json(403, { error: "CLI only" });
          if (!auth.allow(req.socket.remoteAddress || ""))
            return json(429, { error: "Try again later" });
          const input = z
            .object({
              code: z.string().max(128),
              name: z.string().min(1).max(80),
            })
            .strict()
            .parse(await body(req));
          return json(200, await auth.claim(input.code, input.name));
        }
        const session = auth.session(req.headers.cookie);
        if (!session) return json(401, { error: "Login required" });
        if (mutating && req.headers["x-csrf-token"] !== session.csrf)
          return json(403, { error: "CSRF denied" });
        if (path === "/api/session" && req.method === "GET")
          return json(200, { csrf: session.csrf });
        if (path === "/api/logout" && req.method === "POST") {
          auth.logout(req.headers.cookie);
          for (const ws of browsers) ws.close(1008, "Session changed");
          res.setHeader(
            "Set-Cookie",
            "logview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return json(200, {});
        }
        if (path === "/api/pairings" && req.method === "POST")
          return json(200, { code: auth.pairing(), expiresIn: 120 });
        if (path === "/api/agents" && req.method === "GET")
          return json(
            200,
            [...auth.agents].map(([id, a]) => ({
              id,
              name: a.name,
              online: agents.has(id),
            })),
          );
        const m = /^\/api\/agents\/([^/]+)(\/status)?$/.exec(path);
        if (m && req.method === "GET" && m[2])
          return json(200, { online: agents.has(m[1]) });
        if (m && req.method === "DELETE" && !m[2]) {
          await auth.revoke(m[1]);
          agents.get(m[1])?.close(1008, "Revoked");
          return json(200, {});
        }
        return json(404, { error: "Not found" });
      }
      if (req.method !== "GET")
        return json(405, { error: "Method not allowed" });
      const web = resolve(options.webDir || "apps/web/dist");
      const asset = path === "/" ? "index.html" : path.slice(1);
      const full = resolve(web, asset);
      if (!full.startsWith(web + "/")) return json(404, { error: "Not found" });
      const data = await readFile(full);
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(full)] || "application/octet-stream",
      );
      res.end(data);
    } catch {
      json(400, { error: "Request rejected" });
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    const deny = () => {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };
    if (req.url === "/ws/agent") {
      const id = auth.agent(req.headers.authorization);
      if (!id || req.headers.origin) return deny();
      wss.handleUpgrade(req, socket, head, (ws) => {
        agents.get(id)?.close(1000, "Replaced");
        agents.set(id, ws);
        ws.on("message", (raw) => {
          try {
            if (auth.agent(req.headers.authorization) !== id)
              return ws.close(1008);
            const msg = response.parse(JSON.parse(raw.toString()));
            const route = routes.get(msg.requestId);
            if (!route || route.agent !== ws) return;
            send(route.browser, { ...msg, requestId: route.clientId });
            if (!route.watch || msg.type === "error")
              routes.delete(msg.requestId);
          } catch {
            ws.close(1008, "Invalid response");
          }
        });
        ws.on("close", () => {
          if (agents.get(id) === ws) agents.delete(id);
          for (const [key, r] of routes)
            if (r.agent === ws) {
              send(r.browser, {
                requestId: r.clientId,
                type: "error",
                payload: { error: "Agent disconnected" },
              });
              routes.delete(key);
            }
        });
        ws.on("error", () => {});
      });
    } else if (req.url === "/ws/browser") {
      if (
        req.headers.origin !== origin.origin ||
        !auth.session(req.headers.cookie) ||
        browsers.size >= 20
      )
        return deny();
      wss.handleUpgrade(req, socket, head, (ws) => {
        browsers.add(ws);
        let count = 0,
          window = Date.now();
        const expiry = setInterval(() => {
          if (!auth.session(req.headers.cookie))
            ws.close(1008, "Session expired");
        }, 10000);
        ws.on("message", (raw) => {
          let clientId = "invalid";
          try {
            if (!auth.session(req.headers.cookie)) return ws.close(1008);
            if (Date.now() - window > 1000) {
              count = 0;
              window = Date.now();
            }
            if (++count > 60) throw Error("Rate limit");
            const outer = z
              .object({ agentId: z.string().max(128), request: z.unknown() })
              .strict()
              .parse(JSON.parse(raw.toString()));
            const msg = parseRequest(outer.request);
            clientId = msg.requestId;
            if (!auth.agents.has(outer.agentId))
              throw Error("Unauthorized agent");
            const agent = agents.get(outer.agentId);
            if (!agent) throw Error("Agent offline");
            if (msg.type === "cancel") {
              const target = (msg.payload as any).target;
              for (const [key, r] of routes)
                if (
                  r.browser === ws &&
                  r.clientId === target &&
                  r.agentId === outer.agentId
                )
                  discard(key, r);
              return;
            }
            if (
              [...routes.values()].some(
                (r) => r.browser === ws && r.clientId === clientId,
              )
            )
              throw Error("Duplicate request");
            if (
              [...routes.values()].filter((r) => r.browser === ws).length >=
                12 ||
              routes.size >= 128
            )
              throw Error("Concurrency limit");
            if (msg.type === "file.watch.stop")
              for (const [key, r] of routes)
                if (
                  r.browser === ws &&
                  r.agentId === outer.agentId &&
                  r.fileId === (msg.payload as any).fileId
                )
                  discard(key, r);
            const key = randomUUID();
            routes.set(key, {
              browser: ws,
              agent,
              clientId,
              agentId: outer.agentId,
              watch: msg.type === "file.watch.start",
              expires: Date.now() + 20000,
              fileId: (msg.payload as any).fileId,
            });
            send(agent, { ...msg, requestId: key });
          } catch (e) {
            send(ws, {
              requestId: clientId,
              type: "error",
              payload: {
                error: e instanceof Error ? e.message : "Request rejected",
              },
            });
          }
        });
        ws.on("close", () => {
          clearInterval(expiry);
          browsers.delete(ws);
          for (const [key, r] of routes) if (r.browser === ws) discard(key, r);
        });
        ws.on("error", () => {});
      });
    } else deny();
  });
  const timer = setInterval(() => {
    for (const [key, r] of routes)
      if (!r.watch && r.expires < Date.now()) {
        send(r.browser, {
          requestId: r.clientId,
          type: "error",
          payload: { error: "Request timed out" },
        });
        discard(key, r);
      }
  }, 1000);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if ((ws as any).alive === false) {
        ws.terminate();
        continue;
      }
      (ws as any).alive = false;
      ws.ping();
    }
  }, 15000);
  // handleUpgrade does not emit connection automatically.
  server.on("upgrade", () => {
    setImmediate(() => {
      for (const ws of wss.clients)
        if (!(ws as any).heartbeat) {
          (ws as any).heartbeat = true;
          (ws as any).alive = true;
          ws.on("pong", () => {
            (ws as any).alive = true;
          });
        }
    });
  });
  return {
    server,
    auth,
    agents,
    close: async () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
