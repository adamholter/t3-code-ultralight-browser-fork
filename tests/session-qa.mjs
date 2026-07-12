import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const clientModule = process.env.QA_CLIENT_MODULE
  ? pathToFileURL(process.env.QA_CLIENT_MODULE).href
  : new URL("../dist-lib/client.js", import.meta.url).href;
const { createCodexClient, createCodexSession } = await import(clientModule);

const url = process.env.QA_WS_URL ?? "ws://127.0.0.1:4174/ws";
const marker = `SESSION_SMOKE_${Date.now()}`;
const deltas = [];
const events = [];
const observedNotifications = [];
const requiredCapabilities = ["requestOwnership", "threadIsolation"];
const observer = createCodexClient({ url, reconnectMs: false, requiredCapabilities });
observer.on("notification", (message) => observedNotifications.push(message));
const session = createCodexSession({ url, cwd: "/tmp", reconnectMs: false, requiredCapabilities });
let resumeRpcCount = 0;
const request = session.client.request.bind(session.client);
session.client.request = (method, params) => {
  if (method === "thread/resume") resumeRpcCount += 1;
  return request(method, params);
};

try {
  await observer.connect();
  const result = await session.send(`Reply with exactly: ${marker}`, {
    onDelta: (delta) => deltas.push(delta),
    onEvent: ({ method }) => events.push(method),
  });
  assert.equal(result.text.trim(), marker);
  assert.equal(session.threadId, result.threadId);
  assert.ok(deltas.join("").includes(marker), "expected scoped streaming deltas");
  assert.ok(events.includes("turn/completed"), "expected scoped turn events");
  assert.equal(session.client.bridgeInfo?.protocol.major, 1);
  assert.equal(session.client.bridgeInfo?.legacy, false);
  assert.ok(requiredCapabilities.every((capability) => session.client.bridgeInfo?.capabilities.includes(capability)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    observedNotifications.some((message) => message.params?.threadId === result.threadId),
    false,
    "passive browser received another client's thread notifications",
  );

  let cancellationStarted = false;
  let closing;
  await assert.rejects(
    session.send("Write the integers from one to one thousand, one per line.", {
      onTurnStarted: () => {
        cancellationStarted = true;
        closing = session.close();
      },
    }),
    (error) => error instanceof Error && error.name === "AbortError",
  );
  await closing;
  assert.equal(cancellationStarted, true);
  assert.equal(session.running, false);
  assert.equal(session.closed, true);
  assert.equal(resumeRpcCount, 0, "healthy session follow-ups should not resume an already-loaded thread");

  console.log(JSON.stringify({
    threadId: session.threadId,
    streamed: true,
    isolated: true,
    protocol: `${session.client.bridgeInfo?.protocol.major}.${session.client.bridgeInfo?.protocol.minor}`,
    eventCount: events.length,
    cancellation: "interrupted",
    disposal: "interrupt acknowledged before socket close",
    redundantResumes: resumeRpcCount,
  }, null, 2));
} finally {
  if (session.threadId) {
    await observer.request("thread/delete", { threadId: session.threadId }).catch(() => undefined);
  }
  await session.close();
  observer.close();
}
