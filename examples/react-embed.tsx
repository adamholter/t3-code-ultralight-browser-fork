import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";

export function LocalCodexPanel() {
  return (
    <section style={{ height: "min(760px, 80vh)" }}>
      <CodexChatEmbed />
    </section>
  );
}
