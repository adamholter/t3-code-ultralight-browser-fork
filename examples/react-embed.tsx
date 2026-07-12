import { useRef } from "react";
import { CodexChatEmbed, type CodexChatEmbedHandle } from "t3-code-ultralight-browser-fork/react";

export function LocalCodexPanel() {
  const codex = useRef<CodexChatEmbedHandle>(null);
  return (
    <section style={{ height: "min(760px, 80vh)" }}>
      <button onClick={() => codex.current?.sendPrompt("Explain the selected canvas nodes", { newThread: true })}>
        Ask Codex
      </button>
      <CodexChatEmbed controllerRef={codex} />
    </section>
  );
}
