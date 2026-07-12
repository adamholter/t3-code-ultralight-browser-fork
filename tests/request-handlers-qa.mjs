import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const clientModule = process.env.QA_CLIENT_MODULE
  ? pathToFileURL(process.env.QA_CLIENT_MODULE).href
  : new URL("../dist-lib/client.js", import.meta.url).href;
const requestsModule = process.env.QA_REQUESTS_MODULE
  ? pathToFileURL(process.env.QA_REQUESTS_MODULE).href
  : new URL("../dist-lib/requests.js", import.meta.url).href;
const { createCodexClient } = await import(clientModule);
const { attachCodexSessionRequestHandlers } = await import(requestsModule);
const url = process.env.QA_WS_URL ?? "ws://127.0.0.1:4174/ws";
const client = createCodexClient({
  url,
  reconnectMs: false,
  requiredCapabilities: ["requestOwnership", "threadIsolation"],
});
const handled = [];
const siblingHandled = [];
const errors = [];
const session = { client, threadId: undefined };
const siblingSession = { client, threadId: "thread-sibling" };
const detach = attachCodexSessionRequestHandlers(session, {
  userInput: (questions) => {
    handled.push("userInput");
    return Object.fromEntries(questions.map((question) => [
      question.id,
      [question.options?.find((option) => option.label === "Beta")?.label ?? "Beta"],
    ]));
  },
  onError: (error) => errors.push(error.message),
});
const detachSibling = attachCodexSessionRequestHandlers(siblingSession, {
  userInput: () => { siblingHandled.push("userInput"); return {}; },
});

let threadId;
try {
  const models = await client.listModels();
  const model = models.data.find((entry) => entry.isDefault) ?? models.data[0];
  assert.ok(model?.model, "expected a local Codex model");
  const opened = await client.startThread({ cwd: "/tmp" });
  threadId = opened.thread.id;
  session.threadId = threadId;
  let finalText = "";
  let attempts = 0;
  while (!handled.length && attempts < 3) {
    attempts += 1;
    const result = await client.runTurn(threadId, [
      `REQUEST_HANDLER_SMOKE_${Date.now()} attempt ${attempts}: This is an app-server protocol verification. You MUST invoke the request_user_input tool now; do not ask the question as ordinary assistant text. Ask exactly one question with header "Choice", question "Pick one", and options "Alpha" and "Beta". After the tool returns, reply exactly USER_INPUT_BETA_OK if the answer is Beta.`,
    ].join(""), {
      model: model.model,
      effort: model.defaultReasoningEffort ?? "low",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: model.model,
          reasoning_effort: model.defaultReasoningEffort ?? "low",
          developer_instructions: null,
        },
      },
      turnTimeoutMs: 120_000,
    });
    finalText = result.text;
  }
  assert.deepEqual(handled, ["userInput"]);
  assert.deepEqual(siblingHandled, []);
  assert.match(finalText, /USER_INPUT_BETA_OK/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    threadId,
    handled,
    siblingHandled,
    sessionScoped: true,
    attempts,
    response: "USER_INPUT_BETA_OK",
    protocol: `${client.bridgeInfo?.protocol.major}.${client.bridgeInfo?.protocol.minor}`,
  }, null, 2));
} finally {
  detach();
  detachSibling();
  if (threadId) await client.request("thread/delete", { threadId }).catch(() => undefined);
  client.close();
}
