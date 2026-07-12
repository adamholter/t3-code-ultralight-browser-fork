import { createCodexSession, type CodexClient } from "../src/lib/codex-client";
import { attachCodexSessionRequestHandlers } from "../src/lib/server-requests";
import type { CodexChatEmbedProps } from "../src/embed";

declare const client: CodexClient;

client.on("connection", (status) => {
  const value: "ready" | "offline" = status;
  void value;
});

client.on("item/agentMessage/delta", (payload) => {
  const threadId: string = payload.threadId;
  const delta: string = payload.delta;
  void [threadId, delta];
});

client.on("turn/completed", (payload) => {
  const turnId: string = payload.turn.id;
  const message: string | undefined = payload.turn.error?.message;
  void [turnId, message];
});

client.on("serverRequest", (request) => {
  const id: string | number = request.id;
  const method: string = request.method;
  void [id, method];
});

client.on("future/codex/event", (payload) => {
  // Unknown protocol events intentionally retain the compatibility escape hatch.
  const futureValue: any = payload.futureValue;
  void futureValue;
});

declare const dynamicProtocolEvent: string;
client.on(dynamicProtocolEvent, (payload) => {
  // Runtime-discovered protocol methods remain usable without a package update.
  const value: any = payload.value;
  void value;
});

const canvas = createCodexSession({ client, cwd: "/workspace/canvas" });
const voice = createCodexSession({ client, cwd: "/workspace/voice" });

async function typedSurfaceSends() {
  await canvas.send("Arrange these nodes", {
    onDelta: (delta, text) => {
      const deltaText: string = delta;
      const accumulatedText: string = text;
      void [deltaText, accumulatedText];
    },
  });
  await voice.send("Summarize this aloud", {
    onEvent: (event) => {
      const method: string = event.method;
      void method;
    },
  });
}
void typedSurfaceSends;

const detachVoiceRequests = attachCodexSessionRequestHandlers(voice, {
  approval: async (request) => request.method.includes("approval") ? "accept" : "decline",
  userInput: (questions) => Object.fromEntries(questions.map((question) => [question.id, []])),
  onError: (error, request) => void [error.message, request.id],
});
void detachVoiceRequests;

const embedProps: CodexChatEmbedProps = {
  bridgeUrl: "http://127.0.0.1:4174",
  onConnectionChange: (event) => {
    const status: string = event.status;
    void status;
  },
};
void embedProps;

async function typedCatalogs() {
  const models = await client.listModels();
  const threads = await client.listThreads();
  const modelId: string = models.data[0].model;
  const threadId: string = threads.data[0].id;
  return { modelId, threadId };
}
void typedCatalogs;

// @ts-expect-error Known event payloads reject incompatible handlers.
client.on("connection", (status: number) => void status);
