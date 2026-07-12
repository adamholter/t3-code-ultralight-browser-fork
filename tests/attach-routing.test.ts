import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachCodexBridge } from "../server/attach";
import { CodexBridge } from "../server/codex-bridge";

class FakeBridge extends CodexBridge {
  responses: Array<{ id: string | number; result: unknown }> = [];

  override async start() {}
  override async stop() {}
  override async request(method: string) {
    if (method === "thread/start") return { thread: { id: "thread-owned" } };
    return {};
  }
  override respond(id: string | number, result: unknown) {
    this.responses.push({ id, result });
  }
}

describe("attachCodexBridge routing", () => {
  it("routes approvals only to the browser that started the thread", async () => {
    const server = createServer();
    const bridge = new FakeBridge();
    const controller = attachCodexBridge(server, { path: "/codex", autoStart: false, bridge });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const owner = new WebSocket(`ws://127.0.0.1:${port}/codex`);
    const other = new WebSocket(`ws://127.0.0.1:${port}/codex`);
    await Promise.all([opened(owner), opened(other)]);

    owner.send(JSON.stringify({ type: "rpc", id: "start", method: "thread/start", params: {} }));
    await nextMessage(owner, (message) => message.type === "rpcResult" && message.id === "start");

    const otherMessages: any[] = [];
    other.on("message", (raw) => otherMessages.push(JSON.parse(raw.toString())));
    bridge.emit("request", {
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-owned", command: "echo safe" },
    });
    const request = await nextMessage(owner, (message) => message.type === "serverRequest");
    expect(request.id).toBe(99);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(otherMessages.some((message) => message.type === "serverRequest")).toBe(false);

    other.send(JSON.stringify({ type: "respond", id: 99, result: { decision: "accept" } }));
    await nextMessage(other, (message) => message.type === "bridgeError");
    expect(bridge.responses).toHaveLength(0);

    owner.send(JSON.stringify({ type: "respond", id: 99, result: { decision: "accept" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bridge.responses).toEqual([{ id: 99, result: { decision: "accept" } }]);

    await controller.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function opened(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket, predicate: (message: any) => boolean) {
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
