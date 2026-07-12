import {
  CODEX_BROWSER_PROTOCOL,
  legacyCodexBridgeInfo,
  parseCodexBridgeHello,
  type CodexBridgeInfo,
} from "../browser-contract.js";

type Handler = (payload: any) => void;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_CODEX_BRIDGE_URL = "http://127.0.0.1:4174";

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
  /** Cancel the active turn. The client also asks Codex to interrupt it. */
  signal?: AbortSignal;
  /** Receive assistant text already scoped to this turn. */
  onDelta?: (delta: string, text: string) => void;
  /** Receive every app-server notification scoped to this turn. */
  onEvent?: (event: RunTurnEvent) => void;
  /** Receive the turn ID as soon as Codex starts the turn. */
  onTurnStarted?: (turn: { threadId: string; turnId: string }) => void;
  [key: string]: unknown;
}

export interface RunTurnEvent {
  method: string;
  params: any;
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
  /** Resume an existing thread before sending. Defaults to true; set false when it is already loaded. */
  resumeThread?: boolean;
  /** Options used only when a new thread is created. */
  thread?: StartThreadOptions;
  /** Receive the thread ID before the turn starts. */
  onThreadReady?: (thread: { threadId: string; created: boolean }) => void;
}

export interface CodexClientOptions {
  /** Exact WebSocket URL. Use this for attached servers or custom socket paths. */
  url?: string | (() => string);
  /** HTTP(S) origin of a standalone bridge. Defaults to http://127.0.0.1:4174. */
  bridgeUrl?: string | (() => string);
  /** Reconnect delay after a dropped bridge connection. Set false to disable. */
  reconnectMs?: number | false;
  /** Injectable WebSocket implementation for tests and non-browser runtimes. */
  WebSocketImpl?: typeof WebSocket;
  /** Maximum time for the initial socket connection. */
  connectionTimeoutMs?: number;
  /** Maximum time for an individual bridge RPC response. */
  requestTimeoutMs?: number;
  /** Optional bridge capabilities that must be advertised before connecting. */
  requiredCapabilities?: readonly string[];
}

export interface CodexSessionOptions extends CodexClientOptions {
  /** Reuse an existing client. The session will not close a supplied client. */
  client?: CodexClient;
  /** Resume this thread on the first send. */
  threadId?: string;
  cwd?: string;
  model?: string;
  effort?: string;
  permissions?: string;
  thread?: StartThreadOptions;
}

export interface SessionSendOptions extends RunTurnOptions {
  thread?: StartThreadOptions;
  onThreadReady?: (thread: { threadId: string; created: boolean }) => void;
}

export class CodexClient {
  bridgeInfo: CodexBridgeInfo | null = null;
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
    let url: string;
    try {
      url = this.resolveUrl();
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
    this.connectionPromise = new Promise((resolve, reject) => {
      this.resolveConnection = resolve;
      this.rejectConnection = reject;
    });
    const connection = this.connectionPromise;
    this.bridgeInfo = null;
    let handshakeComplete = false;
    const finishHandshake = (info: CodexBridgeInfo) => {
      if (handshakeComplete) return true;
      const incompatibleProtocol = !info.legacy && info.protocol.major !== CODEX_BROWSER_PROTOCOL.major;
      const missingCapabilities = (this.options.requiredCapabilities ?? [])
        .filter((capability) => !info.capabilities.includes(capability));
      if (incompatibleProtocol || missingCapabilities.length) {
        handshakeComplete = true;
        clearTimeout(connectionTimer);
        const error = incompatibleProtocol
          ? new Error(`Incompatible Codex browser protocol: client ${CODEX_BROWSER_PROTOCOL.major}.x, bridge ${info.protocol.major}.${info.protocol.minor}`)
          : new Error(`Codex bridge is missing required capabilities: ${missingCapabilities.join(", ")}`);
        this.manuallyClosed = true;
        this.rejectConnection?.(error);
        this.resolveConnection = null;
        this.rejectConnection = null;
        this.socket?.close(1002, error.message.slice(0, 123));
        return false;
      }
      handshakeComplete = true;
      clearTimeout(connectionTimer);
      this.bridgeInfo = info;
      this.resolveConnection?.();
      this.resolveConnection = null;
      this.rejectConnection = null;
      this.emit("hello", info);
      this.emit("connection", "ready");
      return true;
    };
    const connectionTimer = globalThis.setTimeout(() => {
      const error = new Error(`Codex bridge handshake timed out: ${url}`);
      this.rejectConnection?.(error);
      this.socket?.close();
    }, this.options.connectionTimeoutMs ?? 10_000);
    try {
      this.socket = new Socket(url);
    } catch (cause) {
      clearTimeout(connectionTimer);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.rejectConnection?.(error);
      this.socket = null;
      this.connectionPromise = null;
      this.resolveConnection = null;
      this.rejectConnection = null;
      return connection;
    }
    this.socket.addEventListener("open", () => {
      this.emit("socket", "open");
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (!handshakeComplete) {
          const hello = parseCodexBridgeHello(message);
          if (hello) {
            finishHandshake(hello);
            return;
          }
          if (message?.type === "hello") {
            throw new Error("Codex bridge sent an invalid hello message");
          }
          if (message?.type === "status") {
            if (!finishHandshake(legacyCodexBridgeInfo())) return;
          } else {
            throw new Error("Codex bridge did not begin with hello or status");
          }
        }
        this.onMessage(message);
      } catch (error) {
        const protocolError = error instanceof Error ? error : new Error(String(error));
        if (!handshakeComplete) {
          handshakeComplete = true;
          clearTimeout(connectionTimer);
          this.manuallyClosed = true;
          this.rejectConnection?.(protocolError);
          this.resolveConnection = null;
          this.rejectConnection = null;
          this.socket?.close(1002, protocolError.message.slice(0, 123));
        }
        this.emit("protocolError", protocolError);
      }
    });
    this.socket.addEventListener("error", () => {
      clearTimeout(connectionTimer);
      this.rejectConnection?.(new Error(`Unable to connect to Codex bridge: ${url}`));
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
          () => {
            this.reconnectTimer = null;
            void this.connect().catch((error) => this.emit("reconnectError", error));
          },
          this.options.reconnectMs ?? 900,
        );
      }
    });
    return connection;
  }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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

  respondError(id: string | number, error = "Request declined") {
    this.send({ type: "respondError", id, error });
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
    if (options.signal?.aborted) throw abortError();
    const {
      threadId: existingThreadId,
      resumeThread = true,
      thread: threadOptions = {},
      onThreadReady,
      ...turnOptions
    } = options;
    let threadId = existingThreadId;
    if (threadId && resumeThread) {
      await this.resumeThread(threadId);
    } else if (!threadId) {
      const opened = await this.startThread({
        ...threadOptions,
        ...(threadOptions.cwd ? {} : turnOptions.cwd ? { cwd: turnOptions.cwd } : {}),
      });
      threadId = opened.thread.id;
    }
    onThreadReady?.({ threadId, created: !existingThreadId });
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
    const {
      turnTimeoutMs = 300_000,
      signal,
      onDelta,
      onEvent,
      onTurnStarted,
      ...turnOptions
    } = options;
    if (signal?.aborted) throw abortError();
    let expectedTurnId: string | null = null;
    let startedReported = false;
    let interruptPromise: Promise<unknown> | null = null;
    let output = "";
    let resolveCompleted!: (value: { turn: unknown }) => void;
    let rejectCompleted!: (error: Error) => void;
    const completed = new Promise<{ turn: unknown }>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    void completed.catch(() => undefined);
    const completedMessages = new Map<string, string>();
    const earlyDeltas: any[] = [];
    const earlyItems: any[] = [];
    const earlyCompletions: any[] = [];
    const earlyEvents: any[] = [];

    const appendDelta = (payload: any) => {
      if (payload.turnId !== expectedTurnId) return;
      const delta = payload.delta ?? "";
      output += delta;
      onDelta?.(delta, output);
    };
    const recordItem = (payload: any) => {
      if (
        payload.turnId === expectedTurnId &&
        payload.item?.type === "agentMessage" &&
        typeof payload.item.text === "string"
      ) {
        completedMessages.set(payload.item.id, payload.item.text);
      }
    };
    const completeTurn = (payload: any) => {
      if (payload.turn?.id !== expectedTurnId) return;
      if (payload.turn?.status === "failed") {
        rejectCompleted(new Error(payload.turn?.error?.message ?? "Codex turn failed"));
      } else {
        resolveCompleted({ turn: payload.turn });
      }
    };
    const emitTurnEvent = (message: any) => {
      const params = message.params;
      const eventTurnId = params.turnId ?? params.turn?.id;
      if (eventTurnId && eventTurnId !== expectedTurnId) return;
      onEvent?.({ method: message.method, params });
    };
    const flushEarlyEvents = () => {
      earlyDeltas.splice(0).forEach(appendDelta);
      earlyItems.splice(0).forEach(recordItem);
      earlyEvents.splice(0).forEach(emitTurnEvent);
      earlyCompletions.splice(0).forEach(completeTurn);
    };
    const completionTimer = globalThis.setTimeout(
      () => {
        interruptActiveTurn();
        rejectCompleted(new Error(`Codex turn timed out after ${turnTimeoutMs}ms`));
      },
      turnTimeoutMs,
    );

    const reportStarted = (turnId: string) => {
      expectedTurnId = turnId;
      flushEarlyEvents();
      if (startedReported) return;
      startedReported = true;
      onTurnStarted?.({ threadId, turnId });
    };
    const interruptActiveTurn = () => {
      if (!expectedTurnId || interruptPromise) return;
      interruptPromise = this.interrupt(threadId, expectedTurnId);
    };
    const handleAbort = () => {
      interruptActiveTurn();
      rejectCompleted(abortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    const offStarted = this.on("turn/started", (payload) => {
      if (payload.threadId === threadId && payload.turn?.id) reportStarted(payload.turn.id);
    });
    const offDelta = this.on("item/agentMessage/delta", (payload) => {
      if (payload.threadId !== threadId) return;
      expectedTurnId ? appendDelta(payload) : earlyDeltas.push(payload);
    });
    const offNotification = this.on("notification", (message) => {
      const params = message.params;
      if (params?.threadId !== threadId) return;
      const eventTurnId = params.turnId ?? params.turn?.id;
      if (!expectedTurnId && message.method === "turn/started" && eventTurnId) reportStarted(eventTurnId);
      expectedTurnId ? emitTurnEvent(message) : earlyEvents.push(message);
    });
    const offItemCompleted = this.on("item/completed", (payload) => {
      if (payload.threadId !== threadId) return;
      expectedTurnId ? recordItem(payload) : earlyItems.push(payload);
    });
    const offCompleted = this.on("turn/completed", (payload) => {
      if (payload.threadId !== threadId) return;
      expectedTurnId ? completeTurn(payload) : earlyCompletions.push(payload);
    });

    try {
      const response = await this.request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input,
        ...turnOptions,
      });
      reportStarted(response.turn.id);
      if (signal?.aborted) {
        interruptActiveTurn();
        throw abortError();
      }
      const result = await completed;
      const completedText = [...completedMessages.values()].join("\n\n");
      return {
        threadId,
        turnId: response.turn.id,
        text: completedText.length >= output.length ? completedText : output,
        turn: result.turn,
      };
    } catch (error) {
      const pendingInterrupt = interruptPromise as Promise<unknown> | null;
      if (pendingInterrupt) {
        await pendingInterrupt.catch((interruptError: unknown) => this.emit("protocolError", interruptError));
      }
      throw error;
    } finally {
      clearTimeout(completionTimer);
      signal?.removeEventListener("abort", handleAbort);
      offStarted();
      offDelta();
      offNotification();
      offItemCompleted();
      offCompleted();
    }
  }

  private send(payload: unknown) {
    const Socket = this.options.WebSocketImpl ?? WebSocket;
    if (this.socket?.readyState !== Socket.OPEN) throw new Error("Codex bridge is not connected");
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
    const bridgeUrl = typeof this.options.bridgeUrl === "function"
      ? this.options.bridgeUrl()
      : this.options.bridgeUrl ?? DEFAULT_CODEX_BRIDGE_URL;
    return codexBridgeWebSocketUrl(bridgeUrl);
  }
}

/** Convert a standalone HTTP(S) bridge origin to its WebSocket endpoint. */
export function codexBridgeWebSocketUrl(bridgeUrl = DEFAULT_CODEX_BRIDGE_URL) {
  let parsed: URL;
  try {
    parsed = typeof location === "undefined" ? new URL(bridgeUrl) : new URL(bridgeUrl, location.href);
  } catch {
    throw new Error(`Invalid Codex bridge URL: ${bridgeUrl}`);
  }
  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error(`Invalid Codex bridge URL protocol: ${parsed.protocol || bridgeUrl}`);
  }
  if (parsed.username || parsed.password || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error("Codex bridgeUrl must contain only an HTTP(S) scheme, host, and optional port");
  }
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/ws";
  return parsed.toString();
}

/**
 * Stateful convenience layer for canvas, voice, and other custom interfaces.
 * It remembers the thread between sends and owns cancellation bookkeeping.
 */
export class CodexSession {
  readonly client: CodexClient;
  threadId: string | undefined;
  currentTurnId: string | null = null;
  private readonly ownsClient: boolean;
  private readonly defaults: SessionSendOptions;
  private readonly detachReadinessListeners: Array<() => void>;
  private activeController: AbortController | null = null;
  private activeDone: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private threadReady = false;
  private isClosed = false;

  constructor(options: CodexSessionOptions = {}) {
    const {
      client,
      threadId,
      cwd,
      model,
      effort,
      permissions,
      thread = {},
      ...clientOptions
    } = options;
    this.client = client ?? new CodexClient(clientOptions);
    this.ownsClient = !client;
    this.threadId = threadId;
    this.defaults = {
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      thread: { ...thread, ...(permissions ? { permissions } : {}) },
    };
    this.detachReadinessListeners = [
      this.client.on("connection", (status) => {
        if (status !== "ready") this.threadReady = false;
      }),
      this.client.on("status", (message) => {
        if (message?.status === "reconnecting") this.threadReady = false;
      }),
    ];
  }

  get running() {
    return this.activeController !== null;
  }

  get closed() {
    return this.isClosed;
  }

  async send(input: string | CodexInput[], options: SessionSendOptions = {}) {
    if (this.isClosed) throw new Error("This Codex session is closed");
    if (this.activeController) throw new Error("This Codex session already has an active turn");
    const controller = new AbortController();
    this.activeController = controller;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    this.activeDone = done;
    const forwardAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const onTurnStarted = options.onTurnStarted;
    const onThreadReady = options.onThreadReady;
    try {
      const result = await this.client.chat(input, {
        ...this.defaults,
        ...options,
        thread: { ...this.defaults.thread, ...options.thread },
        threadId: this.threadId,
        resumeThread: !this.threadReady,
        signal: controller.signal,
        onThreadReady: (thread) => {
          this.threadId = thread.threadId;
          this.threadReady = true;
          onThreadReady?.(thread);
        },
        onTurnStarted: (turn) => {
          this.currentTurnId = turn.turnId;
          onTurnStarted?.(turn);
        },
      });
      this.threadId = result.threadId;
      return result;
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
      this.activeController = null;
      this.currentTurnId = null;
      resolveDone();
      if (this.activeDone === done) this.activeDone = null;
    }
  }

  stop() {
    this.activeController?.abort();
  }

  reset(threadId?: string) {
    if (this.isClosed) throw new Error("This Codex session is closed");
    this.stop();
    this.threadId = threadId;
    this.threadReady = false;
    this.currentTurnId = null;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.isClosed = true;
    this.stop();
    this.detachReadinessListeners.splice(0).forEach((detach) => detach());
    const activeDone = this.activeDone;
    if (!activeDone) {
      if (this.ownsClient) this.client.close();
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }
    this.closePromise = activeDone.then(() => {
      if (this.ownsClient) this.client.close();
    });
    return this.closePromise;
  }
}

export const codex = new CodexClient();

export function createCodexClient(options: CodexClientOptions = {}) {
  return new CodexClient(options);
}

export function createCodexSession(options: CodexSessionOptions = {}) {
  return new CodexSession(options);
}

export { CODEX_BROWSER_CAPABILITIES, CODEX_BROWSER_PROTOCOL } from "../browser-contract.js";
export type { CodexBridgeInfo, CodexBrowserCapability } from "../browser-contract.js";

function abortError() {
  const error = new Error("Codex turn was cancelled");
  error.name = "AbortError";
  return error;
}
