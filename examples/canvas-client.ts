import { createCodexClient } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexClient({ url: "ws://127.0.0.1:4174/ws" });
const { thread } = await codex.startThread({ cwd: "/absolute/path/to/project" });

export async function askAboutSelection(selection: unknown[]) {
  return codex.runTurn(
    thread.id,
    `Help with these selected canvas objects:\n${JSON.stringify(selection)}`,
  );
}
