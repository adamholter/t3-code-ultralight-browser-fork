import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { CodexBridge, type CodexBridgeOptions } from "./codex-bridge.js";
import { parseBrowserBridgeMessage } from "./browser-protocol.js";
import { isAllowedOrigin, normalizeAllowedOrigins } from "./origins.js";
import { createCodexBridgeHello, CODEX_BROWSER_CAPABILITIES, CODEX_BROWSER_PROTOCOL } from "../src/browser-contract.js";
import { PACKAGE_VERSION } from "./version.js";

export const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_REQUESTS_PER_CLIENT = 32;
export const DEFAULT_BROWSER_SOCKET_CLOSE_TIMEOUT_MS = 1_000;

export interface AttachCodexBridgeOptions extends CodexBridgeOptions {
  path?: string;
  autoStart?: boolean;
  /** Additional browser origins allowed to open the bridge socket. */
  allowedOrigins?: string[];
  /** Maximum browser WebSocket message size. Defaults to 16 MiB. */
  maxPayloadBytes?: number;
  /** Maximum simultaneous RPC requests from one browser. Defaults to 32. */
  maxPendingRequestsPerClient?: number;
  /** Maximum graceful-close wait before attached browser sockets are terminated. Defaults to 1000 ms. */
  browserSocketCloseTimeoutMs?: number;
  /** Advanced: supply a compatible bridge instance (primarily for tests). */
  bridge?: CodexBridge;
}

export interface CodexBridgeController {
  bridge: CodexBridge;
  /** Minimal lifecycle surface; the concrete `ws` implementation remains an internal detail. */
  webSocketServer: CodexBridgeWebSocketServerHandle;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CodexBridgeWebSocketServerHandle {
  readonly clients: ReadonlySet<unknown>;
  close(callback?: (error?: Error) => void): void;
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
  const socketPath = normalizeWebSocketPath(options.path);
  const maxPayloadBytes = positiveInteger(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, "maxPayloadBytes");
  const maxPendingRequestsPerClient = positiveInteger(options.maxPendingRequestsPerClient, DEFAULT_MAX_PENDING_REQUESTS_PER_CLIENT, "maxPendingRequestsPerClient");
  const browserSocketCloseTimeoutMs = positiveInteger(options.browserSocketCloseTimeoutMs, DEFAULT_BROWSER_SOCKET_CLOSE_TIMEOUT_MS, "browserSocketCloseTimeoutMs");
  const sockets = new Set<WebSocket>();
  const threadOwners = new Map<string, WebSocket>();
  const requestOwners = new Map<string | number, WebSocket>();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: maxPayloadBytes,
    verifyClient: ({ origin }, done) => done(isAllowedOrigin(origin, allowedOrigins), 403, "Browser origin is not allowed"),
  });
  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      return;
    }
    if (pathname !== socketPath) return;
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  };
  server.on("upgrade", handleUpgrade);
  webSocketServer.on("error", (error) => {
    bridge.emit("log", { level: "debug", message: `Browser WebSocket server error: ${error.message}` });
  });

  const send = (socket: WebSocket, payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };
  const broadcast = (payload: unknown) => {
    for (const socket of sockets) send(socket, payload);
  };

  const handleNotification = (notification: { method: string; params?: unknown }) => {
    const payload = { type: "notification", ...notification };
    const threadId = readThreadId(notification.params);
    if (!threadId) {
      broadcast(payload);
      return;
    }
    const owner = threadOwners.get(threadId);
    if (owner?.readyState === WebSocket.OPEN) send(owner, payload);
  };
  const handleRequest = (request: { id: string | number; method: string; params?: unknown }) => {
    const threadId = readThreadId(request.params);
    const owner = threadId ? threadOwners.get(threadId) : undefined;
    if (owner?.readyState === WebSocket.OPEN) {
      requestOwners.set(request.id, owner);
      send(owner, { type: "serverRequest", ...request });
    } else {
      bridge.respondError(
        request.id,
        threadId ? `No browser client owns thread ${threadId}` : `Cannot safely route unscoped server request ${request.method}`,
      );
    }
  };
  const handleReady = () => broadcast({ type: "status", status: "ready" });
  const handleExit = () => broadcast({ type: "status", status: "reconnecting" });
  bridge.on("notification", handleNotification);
  bridge.on("request", handleRequest);
  bridge.on("ready", handleReady);
  bridge.on("exit", handleExit);

  webSocketServer.on("connection", (socket) => {
    let pendingRpcCount = 0;
    sockets.add(socket);
    send(socket, createCodexBridgeHello({
      bridgeVersion: PACKAGE_VERSION,
      maxPayloadBytes,
      maxPendingRequestsPerClient,
    }));
    send(socket, { type: "status", status: bridge.ready ? "ready" : "starting" });

    socket.on("message", async (raw) => {
      let id: string | number | null = null;
      try {
        const message = parseBrowserBridgeMessage(raw.toString());
        id = message.id;
        if (message.type === "rpc") {
          if (pendingRpcCount >= maxPendingRequestsPerClient) {
            send(socket, { type: "rpcError", id, error: `Too many pending browser RPC requests (limit ${maxPendingRequestsPerClient})` });
            return;
          }
          pendingRpcCount += 1;
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
          } finally {
            pendingRpcCount -= 1;
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
    socket.on("error", (error) => {
      bridge.emit("log", { level: "debug", message: `Browser WebSocket error: ${error.message}` });
    });
    socket.on("close", () => {
      sockets.delete(socket);
      for (const [threadId, owner] of threadOwners) {
        if (owner === socket) threadOwners.delete(threadId);
      }
      for (const [requestId, owner] of requestOwners) {
        if (owner !== socket) continue;
        requestOwners.delete(requestId);
        try {
          bridge.respondError(requestId, "Owning browser client disconnected");
        } catch (error) {
          bridge.emit("log", { level: "debug", message: `Unable to reject disconnected browser request ${String(requestId)}: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    });
  });

  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const controller: CodexBridgeController = {
    bridge,
    webSocketServer,
    start: () => stopped ? Promise.reject(new Error("Codex bridge controller has been stopped")) : bridge.start(),
    stop: () => {
      if (stopPromise) return stopPromise;
      stopped = true;
      bridge.off("notification", handleNotification);
      bridge.off("request", handleRequest);
      bridge.off("ready", handleReady);
      bridge.off("exit", handleExit);
      server.off("upgrade", handleUpgrade);
      stopPromise = (async () => {
        const forceClose = setTimeout(() => {
          for (const socket of sockets) {
            if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
          }
        }, browserSocketCloseTimeoutMs);
        try {
          for (const socket of sockets) socket.close(1001, "Codex bridge stopping");
          await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
        } finally {
          clearTimeout(forceClose);
        }
        sockets.clear();
        threadOwners.clear();
        requestOwners.clear();
        await bridge.stop();
      })();
      return stopPromise;
    },
  };

  if (options.autoStart !== false) {
    void controller.start().catch((error) => {
      bridge.emit("log", { level: "error", message: `Unable to start Codex bridge: ${error instanceof Error ? error.message : String(error)}` });
    });
  }
  return controller;
}

function readThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.threadId === "string") return record.threadId;
  if (typeof record.conversationId === "string") return record.conversationId;
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
  return owner === socket;
}

function positiveInteger(value: number | undefined, fallback: number, name: string) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function normalizeWebSocketPath(value = "/codex-ws") {
  if (!value.startsWith("/") || value.startsWith("//")) throw new Error("path must be an absolute URL pathname");
  const parsed = new URL(value, "http://127.0.0.1");
  if (parsed.pathname !== value || parsed.search || parsed.hash) throw new Error("path must contain only an absolute URL pathname");
  return parsed.pathname;
}

export { CodexBridge } from "./codex-bridge.js";
export type { CodexBridgeOptions } from "./codex-bridge.js";
export { parseBrowserBridgeMessage } from "./browser-protocol.js";
export { isAllowedOrigin, normalizeAllowedOrigins, readAllowedOrigins } from "./origins.js";
export { CODEX_BROWSER_CAPABILITIES, CODEX_BROWSER_PROTOCOL } from "../src/browser-contract.js";
