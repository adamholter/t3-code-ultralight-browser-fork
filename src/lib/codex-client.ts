type Handler = (payload: any) => void;

export interface StartThreadOptions {
  cwd?: string;
  model?: string;
  permissions?: string;
  [key: string]: unknown;
}

export interface RunTurnOptions {
  model?: string;
  effort?: string;
  cwd?: string;
  [key: string]: unknown;
}

export interface RunTurnResult {
  threadId: string;
  turnId: string;
  text: string;
  turn: unknown;
}

export interface CodexClientOptions {
  /** WebSocket URL for the localhost bridge. Defaults to /ws on the current host. */
  url?: string | (() => string);
  /** Reconnect delay after a dropped bridge connection. Set false to disable. */
  reconnectMs?: number | false;
  /** Injectable WebSocket implementation for tests and non-browser runtimes. */
  WebSocketImpl?: typeof WebSocket;
}

export class CodexClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private handlers = new Map<string, Set<Handler>>();
  private nextId = 1;
  private reconnectTimer: number | null = null;
  private connectionPromise: Promise<void> | null = null;
  private resolveConnection: (() => void) | null = null;
  private manuallyClosed = false;

  constructor(private readonly options: CodexClientOptions = {}) {}

  connect(): Promise<void> {
    this.manuallyClosed = false;
    const Socket = this.options.WebSocketImpl ?? WebSocket;
    if (this.socket?.readyState === Socket.OPEN) return Promise.resolve();
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = new Promise((resolve) => { this.resolveConnection = resolve; });
    this.socket = new Socket(this.resolveUrl());
    this.socket.addEventListener("open", () => {
      this.resolveConnection?.();
      this.resolveConnection = null;
      this.emit("connection", "ready");
    });
    this.socket.addEventListener("message", (event) => this.onMessage(JSON.parse(event.data)));
    this.socket.addEventListener("close", () => {
      this.emit("connection", "offline");
      this.connectionPromise = null;
      if (!this.manuallyClosed && this.options.reconnectMs !== false) {
        this.reconnectTimer = window.setTimeout(
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
    this.socket?.close();
    this.socket = null;
    this.connectionPromise = null;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.connect();
    const id = `web-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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

  /** Run a text turn and resolve with the final streamed assistant text. */
  async runTurn(threadId: string, text: string, options: RunTurnOptions = {}): Promise<RunTurnResult> {
    let expectedTurnId: string | null = null;
    let output = "";
    let resolveCompleted!: (value: { turn: unknown }) => void;
    let rejectCompleted!: (error: Error) => void;
    const completed = new Promise<{ turn: unknown }>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });

    const offDelta = this.on("item/agentMessage/delta", (payload) => {
      if (payload.threadId === threadId && (!expectedTurnId || payload.turnId === expectedTurnId)) {
        output += payload.delta ?? "";
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
        input: [{ type: "text", text, text_elements: [] }],
        ...options,
      });
      expectedTurnId = response.turn.id;
      const result = await completed;
      return { threadId, turnId: response.turn.id, text: output, turn: result.turn };
    } finally {
      offDelta();
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
