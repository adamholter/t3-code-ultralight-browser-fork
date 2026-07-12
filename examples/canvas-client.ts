import { createCodexClient } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexClient({ url: "ws://127.0.0.1:4174/ws" });
let threadId: string | undefined;

export async function askAboutSelection(selection: unknown[]) {
  const result = await codex.chat(
    `Help with these selected canvas objects:\n${JSON.stringify(selection)}`,
    { threadId, cwd: "/absolute/path/to/project" },
  );
  threadId = result.threadId;
  return result;
}
