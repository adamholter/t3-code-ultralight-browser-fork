export const CODEX_EMBED_SOURCE = "t3-code-ultralight" as const;
export const CODEX_EMBED_VERSION = 1 as const;

const COMMAND_TIMEOUT_MS = 10_000;
const READY_RETRY_MS = 100;
const MAX_PROMPT_LENGTH = 1_000_000;
const MAX_CWD_LENGTH = 16_384;

export interface CodexEmbedSendOptions {
  /** Start a clean thread before sending this prompt. */
  newThread?: boolean;
  /** Override the working directory used by this turn. */
  cwd?: string;
}

export type CodexEmbedCommandPayload =
  | ({ command: "send"; text: string } & CodexEmbedSendOptions)
  | { command: "newThread" }
  | { command: "stop" }
  | { command: "ping" };

export type CodexEmbedCommand = CodexEmbedCommandPayload & {
  source: typeof CODEX_EMBED_SOURCE;
  version: typeof CODEX_EMBED_VERSION;
  direction: "host-command";
  requestId: string;
};

export type CodexEmbedEventPayload =
  | { event: "ready"; status: "ready"; modelCount: number }
  | { event: "connection"; status: "starting" | "ready" | "reconnecting" | "offline" }
  | { event: "thread"; threadId: string | null }
  | { event: "turn"; phase: "started" | "completed"; threadId: string; turnId: string; status?: string; error?: string }
  | { event: "command"; requestId: string; command: CodexEmbedCommandPayload["command"]; ok: boolean; threadId?: string | null; turnId?: string; error?: string }
  | { event: "error"; message: string; threadId?: string | null };

export type CodexEmbedEvent = CodexEmbedEventPayload & {
  source: typeof CODEX_EMBED_SOURCE;
  version: typeof CODEX_EMBED_VERSION;
};

export type CodexEmbedCommandResult = Extract<CodexEmbedEvent, { event: "command" }>;

export interface CodexEmbedCommandHandlers {
  send(text: string, options: CodexEmbedSendOptions): Promise<{ threadId: string; turnId: string }>;
  newThread(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface CodexEmbedController {
  send(text: string, options?: CodexEmbedSendOptions): Promise<CodexEmbedCommandResult>;
  newThread(): Promise<CodexEmbedCommandResult>;
  stop(): Promise<CodexEmbedCommandResult>;
  ready(): Promise<CodexEmbedCommandResult>;
  dispose(): void;
}

export function postCodexEmbedEvent(payload: CodexEmbedEventPayload, targetOrigin = "*") {
  if (typeof window === "undefined" || window.parent === window) return false;
  window.parent.postMessage({
    source: CODEX_EMBED_SOURCE,
    version: CODEX_EMBED_VERSION,
    ...payload,
  } satisfies CodexEmbedEvent, targetOrigin);
  return true;
}

export function isCodexEmbedEvent(value: unknown): value is CodexEmbedEvent {
  if (!isProtocolRecord(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.event === "ready") return message.status === "ready" && typeof message.modelCount === "number";
  if (message.event === "connection") return ["starting", "ready", "reconnecting", "offline"].includes(String(message.status));
  if (message.event === "thread") return message.threadId === null || typeof message.threadId === "string";
  if (message.event === "turn") {
    return ["started", "completed"].includes(String(message.phase))
      && typeof message.threadId === "string"
      && typeof message.turnId === "string";
  }
  if (message.event === "command") {
    return validRequestId(message.requestId)
      && ["send", "newThread", "stop", "ping"].includes(String(message.command))
      && typeof message.ok === "boolean"
      && (message.threadId === undefined || message.threadId === null || typeof message.threadId === "string")
      && (message.turnId === undefined || typeof message.turnId === "string")
      && (message.error === undefined || typeof message.error === "string");
  }
  if (message.event === "error") return typeof message.message === "string";
  return false;
}

export function isCodexEmbedCommand(value: unknown): value is CodexEmbedCommand {
  if (!isProtocolRecord(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.direction !== "host-command" || !validRequestId(message.requestId)) return false;
  if (message.command === "send") {
    return typeof message.text === "string"
      && message.text.trim().length > 0
      && message.text.length <= MAX_PROMPT_LENGTH
      && (message.newThread === undefined || typeof message.newThread === "boolean")
      && (message.cwd === undefined || (typeof message.cwd === "string" && message.cwd.trim().length > 0 && message.cwd.length <= MAX_CWD_LENGTH));
  }
  return ["newThread", "stop", "ping"].includes(String(message.command));
}

/** Match the bridge's browser-origin policy without importing server code into the app. */
export function isAllowedCodexEmbedHostOrigin(origin: string, additional: readonly string[] = [], allowLoopbackOrigins = false) {
  if (additional.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return allowLoopbackOrigins && ["http:", "https:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Subscribe to lifecycle and command-result events from one exact iframe and origin. */
export function subscribeCodexEmbedEvents(
  iframe: HTMLIFrameElement,
  handler: (event: CodexEmbedEvent) => void,
) {
  if (typeof window === "undefined") return () => undefined;
  const expectedOrigin = new URL(iframe.src, window.location.href).origin;
  const listener = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== expectedOrigin || !isCodexEmbedEvent(event.data)) return;
    handler(event.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * Receive host commands inside the embedded chat. The browser-authenticated
 * parent window and Origin must both match the bridge's effective policy.
 */
export function subscribeCodexEmbedCommands(
  handlers: CodexEmbedCommandHandlers,
  additionalAllowedOrigins: readonly string[] = [],
  allowLoopbackOrigins = false,
) {
  if (typeof window === "undefined" || window.parent === window) return () => undefined;
  const listener = (event: MessageEvent) => {
    if (
      event.source !== window.parent
      || !isAllowedCodexEmbedHostOrigin(event.origin, additionalAllowedOrigins, allowLoopbackOrigins)
      || !isCodexEmbedCommand(event.data)
    ) return;
    const command = event.data;
    void executeCommand(command, handlers).then((result) => {
      // Opaque origins cannot be expressed as a postMessage targetOrigin. The
      // exact parent-window check above remains in force for explicitly allowed null.
      postCodexEmbedEvent(result, event.origin === "null" ? "*" : event.origin);
    });
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Build a small imperative controller for a raw iframe, React ref, or element. */
export function createCodexEmbedController(
  iframe: HTMLIFrameElement,
  options: { timeoutMs?: number } = {},
): CodexEmbedController {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Embedded Codex controller timeoutMs must be a positive number");
  const pending = new Map<string, { resolve: (result: CodexEmbedCommandResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let disposed = false;
  let nextId = 1;
  let readyResult: CodexEmbedCommandResult | null = null;
  const markUnready = () => { readyResult = null; };
  iframe.addEventListener("load", markUnready);
  const unsubscribe = subscribeCodexEmbedEvents(iframe, (event) => {
    if (event.event !== "command") return;
    const request = pending.get(event.requestId);
    if (!request) return;
    pending.delete(event.requestId);
    clearTimeout(request.timer);
    if (event.ok) request.resolve(event);
    else request.reject(new Error(event.error ?? `Embedded Codex ${event.command} command failed`));
  });

  const dispatch = (payload: CodexEmbedCommandPayload, commandTimeout = timeoutMs) => new Promise<CodexEmbedCommandResult>((resolve, reject) => {
    if (disposed) {
      reject(new Error("Embedded Codex controller is disposed"));
      return;
    }
    if (!iframe.contentWindow) {
      reject(new Error("Embedded Codex iframe is not attached"));
      return;
    }
    const requestId = `embed-${Date.now().toString(36)}-${nextId++}`;
    const timer = globalThis.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Embedded Codex ${payload.command} command timed out`));
    }, commandTimeout);
    pending.set(requestId, { resolve, reject, timer });
    iframe.contentWindow.postMessage({
      source: CODEX_EMBED_SOURCE,
      version: CODEX_EMBED_VERSION,
      direction: "host-command",
      requestId,
      ...payload,
    } satisfies CodexEmbedCommand, new URL(iframe.src, window.location.href).origin);
  });

  const ready = async () => {
    if (readyResult) return readyResult;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (!disposed && Date.now() < deadline) {
      try {
        readyResult = await dispatch({ command: "ping" }, Math.min(500, Math.max(1, deadline - Date.now())));
        return readyResult;
      } catch (cause) {
        lastError = cause;
        await new Promise((resolve) => globalThis.setTimeout(resolve, READY_RETRY_MS));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Embedded Codex chat did not become ready");
  };

  const run = async (payload: CodexEmbedCommandPayload) => {
    if (!isCodexEmbedCommand({
      source: CODEX_EMBED_SOURCE,
      version: CODEX_EMBED_VERSION,
      direction: "host-command",
      requestId: "validation",
      ...payload,
    })) throw new Error(`Invalid embedded Codex ${payload.command} command`);
    await ready();
    return dispatch(payload);
  };

  return {
    send: (text, sendOptions = {}) => run({ command: "send", text, ...sendOptions }),
    newThread: () => run({ command: "newThread" }),
    stop: () => run({ command: "stop" }),
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      iframe.removeEventListener("load", markUnready);
      for (const [requestId, request] of pending) {
        clearTimeout(request.timer);
        request.reject(new Error("Embedded Codex controller was disposed"));
        pending.delete(requestId);
      }
    },
  };
}

async function executeCommand(
  command: CodexEmbedCommand,
  handlers: CodexEmbedCommandHandlers,
): Promise<Extract<CodexEmbedEventPayload, { event: "command" }>> {
  const base = { event: "command" as const, requestId: command.requestId, command: command.command };
  try {
    if (command.command === "send") return { ...base, ok: true, ...await handlers.send(command.text, { newThread: command.newThread, cwd: command.cwd }) };
    if (command.command === "newThread") await handlers.newThread();
    if (command.command === "stop") await handlers.stop();
    return { ...base, ok: true };
  } catch (cause) {
    return { ...base, ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function isProtocolRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.source === CODEX_EMBED_SOURCE && message.version === CODEX_EMBED_VERSION;
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
