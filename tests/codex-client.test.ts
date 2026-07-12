import { describe, expect, it } from "vitest";
import { createCodexClient } from "../src/lib/codex-client";

type Script = (socket: FakeWebSocket, message: any) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static script: Script = () => undefined;
  readyState = 0;
  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor(_url: string | URL) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(raw: string) {
    FakeWebSocket.script(this, JSON.parse(raw));
  }

  close() {
    this.readyState = 3;
    this.emit("close", {});
  }

  message(payload: unknown) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const WebSocketImpl = FakeWebSocket as unknown as typeof WebSocket;

describe("CodexClient", () => {
  it("times out unanswered RPC requests", async () => {
    FakeWebSocket.script = () => undefined;
    const client = createCodexClient({
      url: "ws://localhost/codex",
      WebSocketImpl,
      reconnectMs: false,
      requestTimeoutMs: 5,
    });
    await expect(client.request("model/list", {})).rejects.toThrow("model/list timed out");
    client.close();
  });

  it("uses a completed agent item when a transport omits text deltas", async () => {
    FakeWebSocket.script = (socket, message) => {
      if (message.method !== "turn/start") return;
      queueMicrotask(() => {
        socket.message({ type: "rpcResult", id: message.id, result: { turn: { id: "turn-1" } } });
        socket.message({
          type: "notification",
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: { type: "agentMessage", id: "message-1", text: "FINAL_TEXT" },
          },
        });
        socket.message({
          type: "notification",
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
        });
      });
    };
    const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
    const result = await client.runTurn("thread-1", "hello", { turnTimeoutMs: 100 });
    expect(result.text).toBe("FINAL_TEXT");
    client.close();
  });

  it("rejects pending requests when the socket closes", async () => {
    FakeWebSocket.script = (socket) => queueMicrotask(() => socket.close());
    const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
    await expect(client.request("thread/list", {})).rejects.toThrow("connection closed");
  });

  it("creates a thread and sends multimodal input through one chat call", async () => {
    const sent: any[] = [];
    FakeWebSocket.script = (socket, message) => {
      sent.push(message);
      if (message.method === "thread/start") {
        queueMicrotask(() => socket.message({
          type: "rpcResult",
          id: message.id,
          result: { thread: { id: "thread-chat" } },
        }));
      }
      if (message.method === "turn/start") {
        queueMicrotask(() => {
          socket.message({ type: "rpcResult", id: message.id, result: { turn: { id: "turn-chat" } } });
          socket.message({
            type: "notification",
            method: "item/completed",
            params: {
              threadId: "thread-chat",
              turnId: "turn-chat",
              item: { type: "agentMessage", id: "message-chat", text: "IMAGE_OK" },
            },
          });
          socket.message({
            type: "notification",
            method: "turn/completed",
            params: { threadId: "thread-chat", turn: { id: "turn-chat", status: "completed" } },
          });
        });
      }
    };
    const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
    const result = await client.chat(
      [{ type: "image", url: "data:image/png;base64,AAAA" }, { type: "text", text: "Describe it" }],
      { cwd: "/tmp", turnTimeoutMs: 100 },
    );
    expect(result).toMatchObject({ threadId: "thread-chat", text: "IMAGE_OK" });
    expect(sent[0]).toMatchObject({ method: "thread/start", params: { cwd: "/tmp" } });
    expect(sent[1].params.input).toHaveLength(2);
    client.close();
  });
});
