import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachCodexBridge } from "../server/attach";
import { CodexBridge } from "../server/codex-bridge";

class ControlledBridge extends CodexBridge {
  resolveSlow: ((value: unknown) => void) | null = null;

  override async start() {}
  override async stop() {}
  override request(method: string) {
    if (method === "slow") return new Promise((resolve) => { this.resolveSlow = resolve; });
    return Promise.resolve({ ok: true });
  }
}

describe("browser transport limits", () => {
  it("rejects malformed messages and bounds in-flight RPC requests", async () => {
    const { socket, bridge, close } = await openBridge({ maxPendingRequestsPerClient: 1 });
    const malformed = nextMessage(socket);
    socket.send("not json");
    expect(await malformed).toMatchObject({ type: "rpcError", id: null, error: "Invalid browser bridge JSON" });

    const limited = nextMessage(socket);
    socket.send(JSON.stringify({ type: "rpc", id: "slow-1", method: "slow" }));
    socket.send(JSON.stringify({ type: "rpc", id: "slow-2", method: "slow" }));
    expect(await limited).toMatchObject({ type: "rpcError", id: "slow-2", error: "Too many pending browser RPC requests (limit 1)" });
    const completed = nextMessage(socket);
    bridge.resolveSlow?.({ done: true });
    expect(await completed).toMatchObject({ type: "rpcResult", id: "slow-1", result: { done: true } });
    await close();
  });

  it("closes a socket that exceeds the configured payload bound", async () => {
    const { socket, close } = await openBridge({ maxPayloadBytes: 64 });
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    socket.send(JSON.stringify({ type: "rpc", id: "large", method: "test", params: { value: "x".repeat(200) } }));
    await expect(closed).resolves.toBe(1009);
    await close();
  });

  it("rejects invalid transport limit configuration before listening", () => {
    const server = createServer();
    expect(() => attachCodexBridge(server, { maxPayloadBytes: 0 })).toThrow("maxPayloadBytes must be a positive integer");
    expect(() => attachCodexBridge(server, { maxPendingRequestsPerClient: 1.5 })).toThrow("maxPendingRequestsPerClient must be a positive integer");
  });
});

async function openBridge(options: { maxPayloadBytes?: number; maxPendingRequestsPerClient?: number }) {
  const server = createServer();
  const bridge = new ControlledBridge();
  const controller = attachCodexBridge(server, { path: "/codex", autoStart: false, bridge, ...options });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/codex`);
  const initialStatus = nextMessage(socket, (message) => message.type === "status");
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  // Consume the initial bridge status before each test's assertions.
  await initialStatus;
  return {
    socket,
    bridge,
    close: async () => {
      socket.close();
      await controller.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function nextMessage(socket: WebSocket, predicate: (message: any) => boolean = () => true) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket message timed out")), 1_000);
    const listener = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}
