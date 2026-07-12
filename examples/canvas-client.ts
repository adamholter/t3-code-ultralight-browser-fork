import { createCodexSession } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexSession();

export async function askAboutSelection(selection: unknown[]) {
  return codex.send(
    `Help with these selected canvas objects:\n${JSON.stringify(selection)}`,
  );
}

export const stopCanvasAssistant = () => codex.stop();
export const closeCanvasAssistant = () => codex.close();
