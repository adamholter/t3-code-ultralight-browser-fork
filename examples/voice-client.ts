import { createCodexClient } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexClient({ url: "ws://127.0.0.1:4174/ws" });
let threadId: string | undefined;

export async function handleTranscript(transcript: string) {
  const response = await codex.chat(transcript, {
    threadId,
    cwd: "/absolute/path/to/project",
  });
  threadId = response.threadId;
  return response.text;
}
