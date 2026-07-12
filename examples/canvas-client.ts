import { createCodexSession } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexSession({
  url: "ws://127.0.0.1:4174/ws",
  cwd: "/absolute/path/to/project",
});

export async function askAboutSelection(selection: unknown[]) {
  return codex.send(
    `Help with these selected canvas objects:\n${JSON.stringify(selection)}`,
  );
}

export const stopCanvasAssistant = () => codex.stop();
