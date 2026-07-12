import { createCodexAssistant } from "t3-code-ultralight-browser-fork/assistant";

const codex = createCodexAssistant();

export async function handleTranscript(transcript: string) {
  const response = await codex.send(transcript);
  return response.text;
}

export const stopSpeakingTurn = () => codex.stop();
export const closeVoiceAssistant = () => codex.close();
