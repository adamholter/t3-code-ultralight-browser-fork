import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachCodexBridge } from "../server/attach";
import { CodexBridge } from "../server/codex-bridge";
import { isAllowedOrigin, normalizeAllowedOrigins, readAllowedOrigins } from "../server/origins";

class OriginTestBridge extends CodexBridge {
  override async start() {}
  override async stop() {}
}

describe("browser origin policy", () => {
  it("normalizes exact origins and rejects unsafe configuration", () => {
    expect(normalizeAllowedOrigins([" https://canvas.example/ ", "https://canvas.example"])).toEqual(["https://canvas.example"]);
    expect(readAllowedOrigins('["https://voice.example:8443","null"]')).toEqual(["https://voice.example:8443", "null"]);
    expect(() => normalizeAllowedOrigins(["*"])).toThrow("wildcards are not supported");
    expect(() => normalizeAllowedOrigins(["https://example.com/path"])).toThrow("scheme, host, and optional port");
    expect(() => readAllowedOrigins("https://example.com")).toThrow("JSON array");
  });

  it("requires exact browser origins unless broad loopback access is explicitly enabled", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(false);
    expect(isAllowedOrigin("https://127.0.0.1:8443")).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", [], true)).toBe(true);
    expect(isAllowedOrigin("https://127.0.0.1:8443", [], true)).toBe(true);
    expect(isAllowedOrigin("https://canvas.example", ["https://canvas.example"])).toBe(true);
    expect(isAllowedOrigin("https://canvas.example.evil.test", ["https://canvas.example"])).toBe(false);
    expect(isAllowedOrigin("null", ["null"])).toBe(true);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it("enforces the policy on real WebSocket handshakes", async () => {
    const server = createServer();
    const controller = attachCodexBridge(server, {
      path: "/codex",
      autoStart: false,
      bridge: new OriginTestBridge(),
      allowedOrigins: ["https://canvas.example"],
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const local = new WebSocket(`ws://127.0.0.1:${port}/codex`, { origin: "http://localhost:3000" });
    const localRejection = rejectionStatus(local);
    const configured = new WebSocket(`ws://127.0.0.1:${port}/codex`, { origin: "https://canvas.example" });
    await opened(configured);
    await expect(localRejection).resolves.toBe(403);

    const rejected = new WebSocket(`ws://127.0.0.1:${port}/codex`, { origin: "https://untrusted.example" });
    await expect(rejectionStatus(rejected)).resolves.toBe(403);

    configured.close();
    await controller.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function opened(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function rejectionStatus(socket: WebSocket) {
  return new Promise<number>((resolve, reject) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => reject(new Error("Untrusted origin unexpectedly connected")));
    socket.once("error", () => undefined);
  });
}
