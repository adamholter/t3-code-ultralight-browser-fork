import { describe, expect, it } from "vitest";
import { createCodexClient, createCodexSession } from "../src/lib/codex-client";

type Script = (socket: FakeWebSocket, message: any) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static script: Script = () => undefined;
  static shouldOpen = () => true;
  static handshake: (() => unknown) | null = () => ({
    type: "hello",
    protocol: { major: 1, minor: 0 },
    bridgeVersion: "test",
    capabilities: ["rpc", "threadIsolation"],
    limits: { maxPayloadBytes: 1024, maxPendingRequestsPerClient: 4 },
  });
  readyState = 0;
  private listeners = new Map<string, Set<(event: any) => void>>();

  constructor(_url: string | URL) {
    const SocketClass = this.constructor as typeof FakeWebSocket;
    if (SocketClass.shouldOpen()) {
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
        const handshake = SocketClass.handshake?.();
        if (handshake) this.message(handshake);
      });
    }
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

class ReconnectWebSocket extends FakeWebSocket {
  static instances: ReconnectWebSocket[] = [];
  static attempts = 0;
  static override shouldOpen = () => ++ReconnectWebSocket.attempts === 1;

  constructor(url: string | URL) {
    super(url);
    ReconnectWebSocket.instances.push(this);
    const attempt = ReconnectWebSocket.instances.length;
    if (attempt > 1) {
      queueMicrotask(() => {
        this.emit("error", {});
        this.close();
      });
    }
  }
}

describe("CodexClient", () => {
  it("negotiates protocol metadata and required capabilities before connecting", async () => {
    const client = createCodexClient({
      url: "ws://localhost/codex",
      WebSocketImpl,
      reconnectMs: false,
      requiredCapabilities: ["threadIsolation"],
    });
    await client.connect();
    expect(client.bridgeInfo).toMatchObject({
      protocol: { major: 1, minor: 0 },
      bridgeVersion: "test",
      capabilities: ["rpc", "threadIsolation"],
      legacy: false,
    });
    client.close();
  });

  it("accepts legacy bridges that begin with a status message", async () => {
    const previous = FakeWebSocket.handshake;
    FakeWebSocket.handshake = () => ({ type: "status", status: "ready" });
    try {
      const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
      await client.connect();
      expect(client.bridgeInfo).toMatchObject({ protocol: { major: 0, minor: 0 }, legacy: true });
      client.close();

      const strictClient = createCodexClient({
        url: "ws://localhost/codex",
        WebSocketImpl,
        reconnectMs: false,
        requiredCapabilities: ["threadIsolation"],
      });
      await expect(strictClient.connect()).rejects.toThrow("missing required capabilities: threadIsolation");
      strictClient.close();
    } finally {
      FakeWebSocket.handshake = previous;
    }
  });

  it("rejects incompatible protocol majors and missing capabilities", async () => {
    const previous = FakeWebSocket.handshake;
    try {
      FakeWebSocket.handshake = () => ({
        type: "hello",
        protocol: { major: 2, minor: 0 },
        bridgeVersion: "future",
        capabilities: ["rpc"],
        limits: { maxPayloadBytes: 1024, maxPendingRequestsPerClient: 4 },
      });
      const incompatible = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
      await expect(incompatible.connect()).rejects.toThrow("client 1.x, bridge 2.0");
      incompatible.close();

      FakeWebSocket.handshake = () => ({
        type: "hello",
        protocol: { major: 1, minor: 0 },
        bridgeVersion: "limited",
        capabilities: ["rpc"],
        limits: { maxPayloadBytes: 1024, maxPendingRequestsPerClient: 4 },
      });
      const limited = createCodexClient({
        url: "ws://localhost/codex",
        WebSocketImpl,
        reconnectMs: false,
        requiredCapabilities: ["threadIsolation"],
      });
      await expect(limited.connect()).rejects.toThrow("missing required capabilities: threadIsolation");
      limited.close();
    } finally {
      FakeWebSocket.handshake = previous;
    }
  });

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

  it("contains failed background reconnects instead of leaking unhandled rejections", async () => {
    ReconnectWebSocket.instances = [];
    ReconnectWebSocket.attempts = 0;
    const client = createCodexClient({
      url: "ws://localhost/codex",
      WebSocketImpl: ReconnectWebSocket as unknown as typeof WebSocket,
      reconnectMs: 0,
    });
    const reconnectFailure = new Promise<Error>((resolve) => client.on("reconnectError", resolve));
    await client.connect();
    ReconnectWebSocket.instances[0].close();
    expect((await reconnectFailure).message).toContain("Unable to connect to Codex bridge");
    client.close();
  });

  it("returns constructor failures as rejected connection promises", async () => {
    class ThrowingWebSocket {
      static readonly OPEN = 1;
      constructor() { throw new Error("Invalid WebSocket URL"); }
    }
    const client = createCodexClient({
      url: "not-a-websocket-url",
      WebSocketImpl: ThrowingWebSocket as unknown as typeof WebSocket,
      reconnectMs: false,
    });
    await expect(client.connect()).rejects.toThrow("Invalid WebSocket URL");
    client.close();
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

  it("streams callbacks scoped to the active turn without sending callback options to Codex", async () => {
    const sent: any[] = [];
    FakeWebSocket.script = (socket, message) => {
      sent.push(message);
      if (message.method !== "turn/start") return;
      queueMicrotask(() => {
        socket.message({ type: "notification", method: "turn/started", params: { threadId: "thread-scope", turn: { id: "turn-scope" } } });
        socket.message({ type: "rpcResult", id: message.id, result: { turn: { id: "turn-scope" } } });
        socket.message({ type: "notification", method: "item/agentMessage/delta", params: { threadId: "other-thread", turnId: "other-turn", delta: "WRONG" } });
        socket.message({ type: "notification", method: "item/agentMessage/delta", params: { threadId: "thread-scope", turnId: "turn-scope", delta: "Hello" } });
        socket.message({ type: "notification", method: "item/agentMessage/delta", params: { threadId: "thread-scope", turnId: "turn-scope", delta: " world" } });
        socket.message({ type: "notification", method: "turn/completed", params: { threadId: "thread-scope", turn: { id: "turn-scope", status: "completed" } } });
      });
    };
    const deltas: Array<[string, string]> = [];
    const events: string[] = [];
    const started: string[] = [];
    const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
    const result = await client.runTurn("thread-scope", "hello", {
      turnTimeoutMs: 100,
      onDelta: (delta, text) => deltas.push([delta, text]),
      onEvent: ({ method }) => events.push(method),
      onTurnStarted: ({ turnId }) => started.push(turnId),
    });
    expect(result.text).toBe("Hello world");
    expect(deltas).toEqual([["Hello", "Hello"], [" world", "Hello world"]]);
    expect(started).toEqual(["turn-scope"]);
    expect(events).toContain("turn/completed");
    expect(sent.find((message) => message.method === "turn/start")?.params).not.toHaveProperty("onDelta");
    expect(sent.find((message) => message.method === "turn/start")?.params).not.toHaveProperty("turnTimeoutMs");
    client.close();
  });

  it("interrupts Codex when a turn is aborted", async () => {
    const sent: any[] = [];
    let started!: () => void;
    const turnStarted = new Promise<void>((resolve) => { started = resolve; });
    FakeWebSocket.script = (socket, message) => {
      sent.push(message);
      if (message.method === "turn/start") {
        queueMicrotask(() => {
          socket.message({ type: "notification", method: "turn/started", params: { threadId: "thread-abort", turn: { id: "turn-abort" } } });
          socket.message({ type: "rpcResult", id: message.id, result: { turn: { id: "turn-abort" } } });
        });
      }
      if (message.method === "turn/interrupt") {
        queueMicrotask(() => socket.message({ type: "rpcResult", id: message.id, result: {} }));
      }
    };
    const controller = new AbortController();
    const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
    const turn = client.runTurn("thread-abort", "keep going", {
      signal: controller.signal,
      turnTimeoutMs: 100,
      onTurnStarted: () => started(),
    });
    await turnStarted;
    controller.abort();
    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
    expect(sent).toContainEqual(expect.objectContaining({ method: "turn/interrupt", params: { threadId: "thread-abort", turnId: "turn-abort" } }));
    client.close();
  });

  it("interrupts a Codex turn when the completion timeout expires", async () => {
    const sent: any[] = [];
    FakeWebSocket.script = (socket, message) => {
      sent.push(message);
      if (message.method === "turn/start") {
        queueMicrotask(() => {
          socket.message({ type: "notification", method: "turn/started", params: { threadId: "thread-timeout", turn: { id: "turn-timeout" } } });
          socket.message({ type: "rpcResult", id: message.id, result: { turn: { id: "turn-timeout" } } });
        });
      }
      if (message.method === "turn/interrupt") {
        queueMicrotask(() => socket.message({ type: "rpcResult", id: message.id, result: {} }));
      }
    };
    const client = createCodexClient({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false });
    await expect(client.runTurn("thread-timeout", "keep going", { turnTimeoutMs: 5 })).rejects.toThrow("timed out after 5ms");
    expect(sent).toContainEqual(expect.objectContaining({ method: "turn/interrupt", params: { threadId: "thread-timeout", turnId: "turn-timeout" } }));
    client.close();
  });

  it("keeps thread state inside a lightweight session", async () => {
    const sent: any[] = [];
    let turnNumber = 0;
    FakeWebSocket.script = (socket, message) => {
      sent.push(message);
      if (message.method === "thread/start") {
        queueMicrotask(() => socket.message({ type: "rpcResult", id: message.id, result: { thread: { id: "thread-session" } } }));
      } else if (message.method === "thread/resume") {
        queueMicrotask(() => socket.message({ type: "rpcResult", id: message.id, result: { thread: { id: "thread-session", turns: [] } } }));
      } else if (message.method === "turn/start") {
        const turnId = `turn-session-${++turnNumber}`;
        queueMicrotask(() => {
          socket.message({ type: "rpcResult", id: message.id, result: { turn: { id: turnId } } });
          socket.message({ type: "notification", method: "item/completed", params: { threadId: "thread-session", turnId, item: { type: "agentMessage", id: `message-${turnNumber}`, text: `ANSWER_${turnNumber}` } } });
          socket.message({ type: "notification", method: "turn/completed", params: { threadId: "thread-session", turn: { id: turnId, status: "completed" } } });
        });
      }
    };
    const session = createCodexSession({ url: "ws://localhost/codex", WebSocketImpl, reconnectMs: false, cwd: "/project" });
    expect((await session.send("first")).text).toBe("ANSWER_1");
    expect(session.threadId).toBe("thread-session");
    expect((await session.send("second")).text).toBe("ANSWER_2");
    expect(sent.filter((message) => message.method === "thread/start")).toHaveLength(1);
    expect(sent.filter((message) => message.method === "thread/resume")).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "thread/start", params: { cwd: "/project" } });
    session.close();
  });
});
