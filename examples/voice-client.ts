import { createCodexSession } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexSession({
  cwd: "/absolute/path/to/project",
});

export async function handleTranscript(transcript: string) {
  const response = await codex.send(transcript);
  return response.text;
}

export const stopSpeakingTurn = () => codex.stop();
export const closeVoiceAssistant = () => codex.close();
