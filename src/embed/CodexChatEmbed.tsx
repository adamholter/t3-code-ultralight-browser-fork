import type { CSSProperties, IframeHTMLAttributes } from "react";

export interface CodexChatEmbedProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src"> {
  /** URL of the running ultralight bridge UI. */
  bridgeUrl?: string;
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
  ...props
}: CodexChatEmbedProps) {
  const src = new URL(bridgeUrl);
  src.searchParams.set("embed", "1");
  return (
    <iframe
      {...props}
      src={src.toString()}
      title={title}
      style={{ ...defaultStyle, ...style }}
      allow="clipboard-read; clipboard-write"
    />
  );
}
