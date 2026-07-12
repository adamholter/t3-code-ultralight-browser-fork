import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { CodexBridge } from "./codex-bridge.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const server = createServer(app);
const bridge = new CodexBridge();
const sockets = new Set<WebSocket>();

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function broadcast(payload: unknown) {
  for (const socket of sockets) send(socket, payload);
}

bridge.on("notification", (notification) => broadcast({ type: "notification", ...notification }));
bridge.on("request", (request) => broadcast({ type: "serverRequest", ...request }));
bridge.on("ready", () => broadcast({ type: "status", status: "ready" }));
bridge.on("exit", () => broadcast({ type: "status", status: "reconnecting" }));
bridge.on("log", (entry) => {
  if (entry.level === "error") console.error(entry.message);
});

app.get("/api/status", (_request, response) => {
  response.json({
    status: bridge.ready ? "ready" : "starting",
    cwd: process.env.HOME ?? process.cwd(),
    version: "0.1.0",
  });
});

const dist = resolve(root, "dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_request, response) => response.sendFile(resolve(dist, "index.html")));
}

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket) => {
  sockets.add(socket);
  send(socket, { type: "status", status: bridge.ready ? "ready" : "starting" });

  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as {
        type: "rpc" | "respond" | "respondError";
        id: string | number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: string;
      };
      if (message.type === "rpc" && message.method) {
        const result = await bridge.request(message.method, message.params, 120_000);
        send(socket, { type: "rpcResult", id: message.id, result });
      } else if (message.type === "respond") {
        bridge.respond(message.id, message.result);
      } else if (message.type === "respondError") {
        bridge.respondError(message.id, message.error ?? "Request declined");
      }
    } catch (error) {
      const id = (() => {
        try { return JSON.parse(raw.toString()).id; } catch { return null; }
      })();
      send(socket, { type: "rpcError", id, error: error instanceof Error ? error.message : String(error) });
    }
  });
  socket.on("close", () => sockets.delete(socket));
});

await bridge.start();
const port = Number(process.env.PORT ?? 4174);
server.listen(port, "127.0.0.1", () => {
  console.log(`Codex bridge listening at http://127.0.0.1:${port}`);
});

function shutdown() {
  bridge.stop();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
