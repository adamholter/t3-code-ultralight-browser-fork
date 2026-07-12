import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { CodexBridge, type CodexBridgeOptions } from "./codex-bridge.js";
import { isAllowedOrigin, normalizeAllowedOrigins } from "./origins.js";

export interface AttachCodexBridgeOptions extends CodexBridgeOptions {
  path?: string;
  autoStart?: boolean;
  /** Additional browser origins allowed to open the bridge socket. */
  allowedOrigins?: string[];
  /** Advanced: supply a compatible bridge instance (primarily for tests). */
  bridge?: CodexBridge;
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
  const bridge = options.bridge ?? new CodexBridge(options);
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const sockets = new Set<WebSocket>();
  const threadOwners = new Map<string, WebSocket>();
  const requestOwners = new Map<string | number, WebSocket>();
  const webSocketServer = new WebSocketServer({
    server,
    path: options.path ?? "/codex-ws",
    verifyClient: ({ origin }, done) => done(isAllowedOrigin(origin, allowedOrigins), 403, "Browser origin is not allowed"),
  });

  const send = (socket: WebSocket, payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };
  const broadcast = (payload: unknown) => {
    for (const socket of sockets) send(socket, payload);
  };

  bridge.on("notification", (notification) => broadcast({ type: "notification", ...notification }));
  bridge.on("request", (request) => {
    const threadId = readThreadId(request.params);
    const owner = threadId ? threadOwners.get(threadId) : undefined;
    if (owner?.readyState === WebSocket.OPEN) {
      requestOwners.set(request.id, owner);
      send(owner, { type: "serverRequest", ...request });
    } else {
      broadcast({ type: "serverRequest", ...request });
    }
  });
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
          const threadId = readThreadId(message.params);
          const previousOwner = threadId ? threadOwners.get(threadId) : undefined;
          if (message.method === "turn/start" && threadId) threadOwners.set(threadId, socket);
          let result: unknown;
          try {
            result = await bridge.request(message.method, message.params, 120_000);
          } catch (error) {
            if (message.method === "turn/start" && threadId) {
              previousOwner ? threadOwners.set(threadId, previousOwner) : threadOwners.delete(threadId);
            }
            throw error;
          }
          const openedThreadId = readThreadId(result);
          if (message.method === "thread/start" && openedThreadId) threadOwners.set(openedThreadId, socket);
          if (message.method === "thread/delete" && threadId) threadOwners.delete(threadId);
          send(socket, { type: "rpcResult", id, result });
        } else if (message.type === "respond") {
          if (!mayRespond(socket, message.id, requestOwners)) {
            send(socket, { type: "bridgeError", error: "This request belongs to another browser client." });
            return;
          }
          requestOwners.delete(message.id);
          bridge.respond(message.id, message.result);
        } else if (message.type === "respondError") {
          if (!mayRespond(socket, message.id, requestOwners)) {
            send(socket, { type: "bridgeError", error: "This request belongs to another browser client." });
            return;
          }
          requestOwners.delete(message.id);
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
    socket.on("close", () => {
      sockets.delete(socket);
      for (const [threadId, owner] of threadOwners) {
        if (owner === socket) threadOwners.delete(threadId);
      }
      for (const [requestId, owner] of requestOwners) {
        if (owner !== socket) continue;
        requestOwners.delete(requestId);
        bridge.respondError(requestId, "Owning browser client disconnected");
      }
    });
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

function readThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.threadId === "string") return record.threadId;
  if (record.thread && typeof record.thread === "object") {
    const id = (record.thread as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function mayRespond(
  socket: WebSocket,
  requestId: string | number,
  owners: Map<string | number, WebSocket>,
) {
  const owner = owners.get(requestId);
  return !owner || owner === socket;
}

export { CodexBridge } from "./codex-bridge.js";
export type { CodexBridgeOptions } from "./codex-bridge.js";
export { isAllowedOrigin, normalizeAllowedOrigins, readAllowedOrigins } from "./origins.js";
