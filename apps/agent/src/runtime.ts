import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { Files } from "./files.js";
import { readChunk } from "./read.js";
import { search } from "./search.js";
import { watchFile } from "./watch.js";
import { decode, MAX_FRAME } from "../../../packages/protocol/src/index.js";
import type { Config } from "./config.js";
export function validateGateway(url: string) {
  const u = new URL(url);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw Error("Use a gateway origin URL");
  if (
    u.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
  )
    throw Error("Remote gateway requires HTTPS");
  return u;
}
export function startAgent(config: Config) {
  if (!config.gateway || !config.credential || !config.agentId)
    throw Error("Pair this agent first");
  const url = validateGateway(config.gateway);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/agent";
  const files = new Files(config);
  let stopped = false,
    socket: WebSocket | undefined,
    retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 250;
  const connect = () => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: "Bearer " + config.agentId + ":" + config.credential,
      },
      maxPayload: MAX_FRAME,
      perMessageDeflate: false,
    });
    socket = ws;
    const active = new Map<string, AbortController>(),
      watches = new Map<string, () => void>();
    const send = (requestId: string, type: string, payload: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const data = JSON.stringify({ requestId, type, payload });
      if (
        ws.bufferedAmount > 2 * MAX_FRAME ||
        Buffer.byteLength(data) > MAX_FRAME
      ) {
        ws.close(1009);
        return;
      }
      ws.send(data);
    };
    const clear = () => {
      for (const c of active.values()) c.abort();
      for (const stop of watches.values()) stop();
      active.clear();
      watches.clear();
    };
    ws.on("open", () => {
      delay = 250;
    });
    ws.on("message", async (raw) => {
      let requestId = randomUUID() as string;
      try {
        const req = decode(raw.toString());
        requestId = req.requestId;
        const p = req.payload as any;
        if (req.type === "cancel") {
          active.get(p.target)?.abort();
          watches.get(p.target)?.();
          watches.delete(p.target);
          return;
        }
        if (active.has(requestId) || watches.has(requestId))
          throw Error("Duplicate request");
        if (active.size >= 8) throw Error("Agent busy");
        const controller = new AbortController();
        active.set(requestId, controller);
        const timeout = setTimeout(() => controller.abort(), 18000);
        try {
          let result: unknown;
          switch (req.type) {
            case "folder.list":
              result = files.roots();
              break;
            case "folder.add":
              files.root(p.rootId);
              result = { selected: true };
              break;
            case "folder.remove":
              files.root(p.rootId);
              result = { selected: false };
              break;
            case "file.list":
              result = await files.list(p.rootId, p.directoryId);
              break;
            case "file.read":
              result = await readChunk(
                files,
                p.fileId,
                p.offset,
                p.limitBytes,
                p.direction,
              );
              break;
            case "file.tail":
              result = await readChunk(
                files,
                p.fileId,
                0,
                65536,
                "forward",
                true,
              );
              break;
            case "file.search":
              result = await search(
                files,
                p.fileId,
                p.query,
                p.regex,
                controller.signal,
              );
              break;
            case "file.watch.start":
              if (watches.size >= 8) throw Error("Watch limit");
              watches.set(
                requestId,
                watchFile(files, p.fileId, (value) =>
                  send(requestId, "changed", value),
                ),
              );
              result = { watching: true };
              break;
            case "file.watch.stop":
              result = { watching: false };
              break;
          }
          controller.signal.throwIfAborted();
          send(requestId, "result", result);
        } finally {
          clearTimeout(timeout);
          active.delete(requestId);
        }
      } catch (e) {
        send(requestId, "error", {
          error:
            e instanceof Error && "code" in e
              ? "File operation failed"
              : e instanceof Error
                ? e.message.slice(0, 1024)
                : "Operation failed",
        });
      }
    });
    ws.on("close", (code) => {
      clear();
      if (!stopped && code !== 1008) {
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      }
    });
    ws.on("error", () => {});
  };
  connect();
  return {
    files,
    get socket() {
      return socket;
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
