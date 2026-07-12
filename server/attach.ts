import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { CodexBridge, type CodexBridgeOptions } from "./codex-bridge.js";

export interface AttachCodexBridgeOptions extends CodexBridgeOptions {
  path?: string;
  autoStart?: boolean;
  /** Additional browser origins allowed to open the bridge socket. */
  allowedOrigins?: string[];
}

export interface CodexBridgeController {
  bridge: CodexBridge;
  webSocketServer: WebSocketServer;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Attach the local Codex JSON-RPC bridge to any existing Node HTTP server.
 * The browser-facing protocol intentionally stays tiny: rpc, rpcResult,
 * notification, serverRequest, and respond.
 */
export function attachCodexBridge(
  server: Server,
  options: AttachCodexBridgeOptions = {},
): CodexBridgeController {
  const bridge = new CodexBridge(options);
  const sockets = new Set<WebSocket>();
  const webSocketServer = new WebSocketServer({
    server,
    path: options.path ?? "/codex-ws",
    verifyClient: ({ origin }, done) => done(isAllowedOrigin(origin, options.allowedOrigins)),
  });

  const send = (socket: WebSocket, payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };
  const broadcast = (payload: unknown) => {
    for (const socket of sockets) send(socket, payload);
  };

  bridge.on("notification", (notification) => broadcast({ type: "notification", ...notification }));
  bridge.on("request", (request) => broadcast({ type: "serverRequest", ...request }));
  bridge.on("ready", () => broadcast({ type: "status", status: "ready" }));
  bridge.on("exit", () => broadcast({ type: "status", status: "reconnecting" }));

  webSocketServer.on("connection", (socket) => {
    sockets.add(socket);
    send(socket, { type: "status", status: bridge.ready ? "ready" : "starting" });

    socket.on("message", async (raw) => {
      let id: string | number | null = null;
      try {
        const message = JSON.parse(raw.toString()) as {
          type: "rpc" | "respond" | "respondError";
          id: string | number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: string;
        };
        id = message.id;
        if (message.type === "rpc" && message.method) {
          const result = await bridge.request(message.method, message.params, 120_000);
          send(socket, { type: "rpcResult", id, result });
        } else if (message.type === "respond") {
          bridge.respond(message.id, message.result);
        } else if (message.type === "respondError") {
          bridge.respondError(message.id, message.error ?? "Request declined");
        }
      } catch (error) {
        send(socket, {
          type: "rpcError",
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });

  const controller: CodexBridgeController = {
    bridge,
    webSocketServer,
    start: () => bridge.start(),
    stop: async () => {
      await bridge.stop();
      for (const socket of sockets) socket.close();
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    },
  };

  if (options.autoStart !== false) void controller.start();
  return controller;
}

function isAllowedOrigin(origin: string | undefined, additional: string[] = []) {
  if (!origin) return true;
  if (additional.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export { CodexBridge } from "./codex-bridge.js";
export type { CodexBridgeOptions } from "./codex-bridge.js";
