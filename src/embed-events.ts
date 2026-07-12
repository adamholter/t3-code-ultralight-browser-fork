export const CODEX_EMBED_SOURCE = "t3-code-ultralight" as const;
export const CODEX_EMBED_VERSION = 1 as const;

export type CodexEmbedEventPayload =
  | { event: "ready"; status: "ready"; modelCount: number }
  | { event: "connection"; status: "starting" | "ready" | "reconnecting" | "offline" }
  | { event: "thread"; threadId: string | null }
  | { event: "turn"; phase: "started" | "completed"; threadId: string; turnId: string; status?: string; error?: string }
  | { event: "error"; message: string; threadId?: string | null };

export type CodexEmbedEvent = CodexEmbedEventPayload & {
  source: typeof CODEX_EMBED_SOURCE;
  version: typeof CODEX_EMBED_VERSION;
};

export function postCodexEmbedEvent(payload: CodexEmbedEventPayload) {
  if (typeof window === "undefined" || window.parent === window) return false;
  window.parent.postMessage({
    source: CODEX_EMBED_SOURCE,
    version: CODEX_EMBED_VERSION,
    ...payload,
  } satisfies CodexEmbedEvent, "*");
  return true;
}

export function isCodexEmbedEvent(value: unknown): value is CodexEmbedEvent {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.source !== CODEX_EMBED_SOURCE || message.version !== CODEX_EMBED_VERSION) return false;
  if (message.event === "ready") return message.status === "ready" && typeof message.modelCount === "number";
  if (message.event === "connection") return ["starting", "ready", "reconnecting", "offline"].includes(String(message.status));
  if (message.event === "thread") return message.threadId === null || typeof message.threadId === "string";
  if (message.event === "turn") {
    return ["started", "completed"].includes(String(message.phase))
      && typeof message.threadId === "string"
      && typeof message.turnId === "string";
  }
  if (message.event === "error") return typeof message.message === "string";
  return false;
}

/** Subscribe to lifecycle-only events from one exact iframe and origin. */
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
