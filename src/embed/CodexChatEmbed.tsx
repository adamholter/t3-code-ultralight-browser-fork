import type { CSSProperties, IframeHTMLAttributes, Ref } from "react";
import { useEffect, useImperativeHandle, useRef } from "react";
import {
  createCodexEmbedController,
  subscribeCodexEmbedEvents,
  type CodexEmbedCommandResult,
  type CodexEmbedController,
  type CodexEmbedEvent,
  type CodexEmbedSendOptions,
} from "../embed-events";
import { buildEmbedUrl } from "../embed-url";

export interface CodexChatEmbedProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src"> {
  /** URL of the running ultralight bridge UI. */
  bridgeUrl?: string;
  /** Optional same-origin WebSocket path for a path-mounted or token-scoped bridge. */
  websocketPath?: string;
  /** Optional same-origin status path for the embedded host-origin policy. */
  statusPath?: string;
  onCodexEvent?: (event: CodexEmbedEvent) => void;
  onCodexReady?: (event: Extract<CodexEmbedEvent, { event: "ready" }>) => void;
  onConnectionChange?: (event: Extract<CodexEmbedEvent, { event: "connection" }>) => void;
  onThreadChange?: (event: Extract<CodexEmbedEvent, { event: "thread" }>) => void;
  onTurnChange?: (event: Extract<CodexEmbedEvent, { event: "turn" }>) => void;
  onCodexError?: (event: Extract<CodexEmbedEvent, { event: "error" }>) => void;
  /** Imperative send/stop/new-thread handle, compatible with React 18 and 19. */
  controllerRef?: Ref<CodexChatEmbedHandle>;
}

export interface CodexChatEmbedHandle {
  sendPrompt(text: string, options?: CodexEmbedSendOptions): Promise<CodexEmbedCommandResult>;
  newThread(): Promise<CodexEmbedCommandResult>;
  stop(): Promise<CodexEmbedCommandResult>;
}

const defaultStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 420,
  border: 0,
  borderRadius: 10,
  background: "transparent",
};

/**
 * Conflict-free React embedding. The iframe keeps the T3-derived styles fully
 * isolated from the host app; use the headless client export for custom UIs.
 */
export function CodexChatEmbed({
  bridgeUrl = "http://127.0.0.1:4174",
  websocketPath,
  statusPath,
  style,
  title = "Local Codex chat",
  onCodexEvent,
  onCodexReady,
  onConnectionChange,
  onThreadChange,
  onTurnChange,
  onCodexError,
  controllerRef: handleRef,
  ...props
}: CodexChatEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const controllerRef = useRef<CodexEmbedController | null>(null);
  const src = buildEmbedUrl(bridgeUrl, { websocketPath, statusPath });

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const controller = createCodexEmbedController(iframe);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [src]);

  useImperativeHandle(handleRef, () => ({
    sendPrompt: async (text, options) => requireController(controllerRef).send(text, options),
    newThread: async () => requireController(controllerRef).newThread(),
    stop: async () => requireController(controllerRef).stop(),
  }), []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    return subscribeCodexEmbedEvents(iframe, (event) => {
      onCodexEvent?.(event);
      if (event.event === "ready") onCodexReady?.(event);
      if (event.event === "connection") onConnectionChange?.(event);
      if (event.event === "thread") onThreadChange?.(event);
      if (event.event === "turn") onTurnChange?.(event);
      if (event.event === "error") onCodexError?.(event);
    });
  }, [src, onCodexEvent, onCodexReady, onConnectionChange, onThreadChange, onTurnChange, onCodexError]);

  return (
    <iframe
      {...props}
      ref={iframeRef}
      src={src}
      title={title}
      style={{ ...defaultStyle, ...style }}
      allow="clipboard-read; clipboard-write"
    />
  );
}

function requireController(ref: { current: CodexEmbedController | null }) {
  if (!ref.current) throw new Error("Embedded Codex chat is not connected");
  return ref.current;
}
