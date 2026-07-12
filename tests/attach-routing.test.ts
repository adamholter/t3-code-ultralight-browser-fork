import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachCodexBridge } from "../server/attach";
import { CodexBridge } from "../server/codex-bridge";

class FakeBridge extends CodexBridge {
  responses: Array<{ id: string | number; result: unknown }> = [];
  errors: Array<{ id: string | number; message: string }> = [];

  override async start() {}
  override async stop() {}
  override async request(method: string) {
    if (method === "thread/start") return { thread: { id: "thread-owned" } };
    return {};
  }
  override respond(id: string | number, result: unknown) {
    this.responses.push({ id, result });
  }
  override respondError(id: string | number, message: string) {
    this.errors.push({ id, message });
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
    const ownerHello = nextMessage(owner, (message) => message.type === "hello");
    const otherHello = nextMessage(other, (message) => message.type === "hello");
    await Promise.all([opened(owner), opened(other)]);
    await expect(ownerHello).resolves.toMatchObject({
      protocol: { major: 1, minor: 1 },
      capabilities: expect.arrayContaining(["rpc", "requestOwnership", "threadIsolation"]),
    });
    await expect(otherHello).resolves.toMatchObject({ type: "hello" });

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

    const ownedNotification = nextMessage(owner, (message) => message.method === "item/agentMessage/delta");
    bridge.emit("notification", {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-owned", turnId: "turn-owned", delta: "private output" },
    });
    expect((await ownedNotification).params.delta).toBe("private output");
    bridge.emit("notification", {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-without-owner", turnId: "turn-unowned", delta: "unowned output" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(otherMessages.some((message) => message.type === "notification")).toBe(false);

    other.send(JSON.stringify({ type: "respond", id: 99, result: { decision: "accept" } }));
    await nextMessage(other, (message) => message.type === "bridgeError");
    expect(bridge.responses).toHaveLength(0);

    owner.send(JSON.stringify({ type: "respond", id: 99, result: { decision: "accept" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bridge.responses).toEqual([{ id: 99, result: { decision: "accept" } }]);

    other.send(JSON.stringify({ type: "respond", id: 99, result: { decision: "decline" } }));
    await nextMessage(other, (message) => message.type === "bridgeError");
    expect(bridge.responses).toHaveLength(1);

    bridge.emit("request", {
      id: 100,
      method: "execCommandApproval",
      params: { conversationId: "thread-owned", command: ["echo", "legacy"] },
    });
    expect((await nextMessage(owner, (message) => message.type === "serverRequest" && message.id === 100)).method).toBe("execCommandApproval");
    owner.send(JSON.stringify({ type: "respond", id: 100, result: { decision: "approved" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    bridge.emit("request", { id: 101, method: "item/tool/requestUserInput", params: { threadId: "thread-without-owner" } });
    bridge.emit("request", { id: 102, method: "attestation/generate", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bridge.errors).toEqual([
      { id: 101, message: "No browser client owns thread thread-without-owner" },
      { id: 102, message: "Cannot safely route unscoped server request attestation/generate" },
    ]);
    expect(otherMessages.some((message) => message.id === 101 || message.id === 102)).toBe(false);

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
