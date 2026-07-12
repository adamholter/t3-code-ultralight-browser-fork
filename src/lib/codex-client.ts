type Handler = (payload: any) => void;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface StartThreadOptions {
  cwd?: string;
  model?: string;
  permissions?: string;
  [key: string]: unknown;
}

export type CodexInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: "image"; url: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "localImage"; path: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export interface RunTurnOptions {
  model?: string;
  effort?: string;
  cwd?: string;
  /** Maximum time to wait for turn/completed. Not sent to Codex. */
  turnTimeoutMs?: number;
  [key: string]: unknown;
}

export interface RunTurnResult {
  threadId: string;
  turnId: string;
  text: string;
  turn: unknown;
}

export interface ChatOptions extends RunTurnOptions {
  /** Resume this thread before sending. Omit to create a new thread. */
  threadId?: string;
  /** Options used only when a new thread is created. */
  thread?: StartThreadOptions;
}

export interface CodexClientOptions {
  /** WebSocket URL for the localhost bridge. Defaults to /ws on the current host. */
  url?: string | (() => string);
  /** Reconnect delay after a dropped bridge connection. Set false to disable. */
  reconnectMs?: number | false;
  /** Injectable WebSocket implementation for tests and non-browser runtimes. */
  WebSocketImpl?: typeof WebSocket;
  /** Maximum time for the initial socket connection. */
  connectionTimeoutMs?: number;
  /** Maximum time for an individual bridge RPC response. */
  requestTimeoutMs?: number;
}

export class CodexClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private handlers = new Map<string, Set<Handler>>();
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionPromise: Promise<void> | null = null;
  private resolveConnection: (() => void) | null = null;
  private rejectConnection: ((error: Error) => void) | null = null;
  private manuallyClosed = false;

  constructor(private readonly options: CodexClientOptions = {}) {}

  connect(): Promise<void> {
    this.manuallyClosed = false;
    const Socket = this.options.WebSocketImpl ?? WebSocket;
    if (this.socket?.readyState === Socket.OPEN) return Promise.resolve();
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = new Promise((resolve, reject) => {
      this.resolveConnection = resolve;
      this.rejectConnection = reject;
    });
    const connectionTimer = globalThis.setTimeout(() => {
      const error = new Error(`Codex bridge connection timed out: ${this.resolveUrl()}`);
      this.rejectConnection?.(error);
      this.socket?.close();
    }, this.options.connectionTimeoutMs ?? 10_000);
    this.socket = new Socket(this.resolveUrl());
    this.socket.addEventListener("open", () => {
      clearTimeout(connectionTimer);
      this.resolveConnection?.();
      this.resolveConnection = null;
      this.rejectConnection = null;
      this.emit("connection", "ready");
    });
    this.socket.addEventListener("message", (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)));
      } catch (error) {
        this.emit("protocolError", error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.socket.addEventListener("error", () => {
      clearTimeout(connectionTimer);
      this.rejectConnection?.(new Error(`Unable to connect to Codex bridge: ${this.resolveUrl()}`));
      this.rejectConnection = null;
    });
    this.socket.addEventListener("close", () => {
      clearTimeout(connectionTimer);
      const error = new Error("Codex bridge connection closed");
      this.rejectConnection?.(error);
      this.rejectConnection = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.emit("connection", "offline");
      this.connectionPromise = null;
      if (!this.manuallyClosed && this.options.reconnectMs !== false) {
        this.reconnectTimer = globalThis.setTimeout(
          () => void this.connect(),
          this.options.reconnectMs ?? 900,
        );
      }
    });
    return this.connectionPromise;
  }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.rejectConnection?.(new Error("Codex bridge connection closed by client"));
    this.socket?.close();
    this.socket = null;
    this.connectionPromise = null;
    this.resolveConnection = null;
    this.rejectConnection = null;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.connect();
    const id = `web-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.options.requestTimeoutMs ?? 120_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: "rpc", id, method, params });
    });
  }

  respond(id: string | number, result: unknown) {
    this.send({ type: "respond", id, result });
  }

  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => { set.delete(handler); };
  }

  listThreads(params: Record<string, unknown> = {}) {
    return this.request<{ data: unknown[]; nextCursor: string | null }>("thread/list", {
      limit: 100,
      sortKey: "recency_at",
      sortDirection: "desc",
      ...params,
    });
  }

  listModels(params: Record<string, unknown> = {}) {
    return this.request<{ data: unknown[]; nextCursor: string | null }>("model/list", {
      limit: 100,
      ...params,
    });
  }

  startThread(options: StartThreadOptions = {}) {
    return this.request<{ thread: { id: string }; [key: string]: unknown }>("thread/start", options);
  }

  resumeThread(threadId: string, options: Record<string, unknown> = {}) {
    return this.request<{ thread: { id: string; turns: unknown[] }; [key: string]: unknown }>(
      "thread/resume",
      { threadId, ...options },
    );
  }

  interrupt(threadId: string, turnId: string) {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  /**
   * Simplest integration path: create or resume a thread, run one turn, and
   * return the final text plus IDs for continuation.
   */
  async chat(input: string | CodexInput[], options: ChatOptions = {}) {
    const { threadId: existingThreadId, thread: threadOptions = {}, ...turnOptions } = options;
    let threadId = existingThreadId;
    if (threadId) {
      await this.resumeThread(threadId);
    } else {
      const opened = await this.startThread({
        ...threadOptions,
        ...(threadOptions.cwd ? {} : turnOptions.cwd ? { cwd: turnOptions.cwd } : {}),
      });
      threadId = opened.thread.id;
    }
    return typeof input === "string"
      ? this.runTurn(threadId, input, turnOptions)
      : this.runInput(threadId, input, turnOptions);
  }

  /** Run a text turn and resolve with the final streamed assistant text. */
  async runTurn(threadId: string, text: string, options: RunTurnOptions = {}): Promise<RunTurnResult> {
    return this.runInput(
      threadId,
      [{ type: "text", text, text_elements: [] }],
      options,
    );
  }

  /** Run text, image, local-image, skill, or mention input in an existing thread. */
  async runInput(threadId: string, input: CodexInput[], options: RunTurnOptions = {}): Promise<RunTurnResult> {
    const { turnTimeoutMs = 300_000, ...turnOptions } = options;
    let expectedTurnId: string | null = null;
    let output = "";
    let resolveCompleted!: (value: { turn: unknown }) => void;
    let rejectCompleted!: (error: Error) => void;
    const completed = new Promise<{ turn: unknown }>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const completedMessages = new Map<string, string>();
    const completionTimer = globalThis.setTimeout(
      () => rejectCompleted(new Error(`Codex turn timed out after ${turnTimeoutMs}ms`)),
      turnTimeoutMs,
    );

    const offDelta = this.on("item/agentMessage/delta", (payload) => {
      if (payload.threadId === threadId && (!expectedTurnId || payload.turnId === expectedTurnId)) {
        output += payload.delta ?? "";
      }
    });
    const offItemCompleted = this.on("item/completed", (payload) => {
      if (
        payload.threadId === threadId &&
        (!expectedTurnId || payload.turnId === expectedTurnId) &&
        payload.item?.type === "agentMessage" &&
        typeof payload.item.text === "string"
      ) {
        completedMessages.set(payload.item.id, payload.item.text);
      }
    });
    const offCompleted = this.on("turn/completed", (payload) => {
      if (payload.threadId !== threadId || (expectedTurnId && payload.turn?.id !== expectedTurnId)) return;
      if (payload.turn?.status === "failed") {
        rejectCompleted(new Error(payload.turn?.error?.message ?? "Codex turn failed"));
      } else {
        resolveCompleted({ turn: payload.turn });
      }
    });

    try {
      const response = await this.request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input,
        ...turnOptions,
      });
      expectedTurnId = response.turn.id;
      const result = await completed;
      const completedText = [...completedMessages.values()].join("\n\n");
      return {
        threadId,
        turnId: response.turn.id,
        text: completedText.length >= output.length ? completedText : output,
        turn: result.turn,
      };
    } finally {
      clearTimeout(completionTimer);
      offDelta();
      offItemCompleted();
      offCompleted();
    }
  }

  private send(payload: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Codex bridge is not connected");
    this.socket.send(JSON.stringify(payload));
  }

  private onMessage(message: any) {
    if (message.type === "rpcResult" || message.type === "rpcError") {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      message.type === "rpcError" ? request.reject(new Error(message.error)) : request.resolve(message.result);
      return;
    }
    this.emit(message.type, message);
    if (message.type === "notification") this.emit(message.method, message.params);
  }

  private emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  private resolveUrl() {
    if (typeof this.options.url === "function") return this.options.url();
    if (this.options.url) return this.options.url;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  }
}

export const codex = new CodexClient();

export function createCodexClient(options: CodexClientOptions = {}) {
  return new CodexClient(options);
}
