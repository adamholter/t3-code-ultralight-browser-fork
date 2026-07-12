import type { CSSProperties, IframeHTMLAttributes } from "react";
import { useEffect, useRef } from "react";
import { subscribeCodexEmbedEvents, type CodexEmbedEvent } from "../embed-events";
import { buildEmbedUrl } from "../embed-url";

export interface CodexChatEmbedProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src"> {
  /** URL of the running ultralight bridge UI. */
  bridgeUrl?: string;
  onCodexEvent?: (event: CodexEmbedEvent) => void;
  onCodexReady?: (event: Extract<CodexEmbedEvent, { event: "ready" }>) => void;
  onConnectionChange?: (event: Extract<CodexEmbedEvent, { event: "connection" }>) => void;
  onThreadChange?: (event: Extract<CodexEmbedEvent, { event: "thread" }>) => void;
  onTurnChange?: (event: Extract<CodexEmbedEvent, { event: "turn" }>) => void;
  onCodexError?: (event: Extract<CodexEmbedEvent, { event: "error" }>) => void;
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
  style,
  title = "Local Codex chat",
  onCodexEvent,
  onCodexReady,
  onConnectionChange,
  onThreadChange,
  onTurnChange,
  onCodexError,
  ...props
}: CodexChatEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = buildEmbedUrl(bridgeUrl);

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
