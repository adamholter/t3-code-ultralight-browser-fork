import assert from "node:assert/strict";
import { createCodexSession } from "../dist-lib/client.js";

const url = process.env.QA_WS_URL ?? "ws://127.0.0.1:4174/ws";
const marker = `SESSION_SMOKE_${Date.now()}`;
const deltas = [];
const events = [];
const session = createCodexSession({ url, cwd: "/tmp", reconnectMs: false });

try {
  const result = await session.send(`Reply with exactly: ${marker}`, {
    onDelta: (delta) => deltas.push(delta),
    onEvent: ({ method }) => events.push(method),
  });
  assert.equal(result.text.trim(), marker);
  assert.equal(session.threadId, result.threadId);
  assert.ok(deltas.join("").includes(marker), "expected scoped streaming deltas");
  assert.ok(events.includes("turn/completed"), "expected scoped turn events");

  let cancellationStarted = false;
  await assert.rejects(
    session.send("Write the integers from one to one thousand, one per line.", {
      onTurnStarted: () => {
        cancellationStarted = true;
        session.stop();
      },
    }),
    (error) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(cancellationStarted, true);
  assert.equal(session.running, false);

  console.log(JSON.stringify({
    threadId: session.threadId,
    streamed: true,
    eventCount: events.length,
    cancellation: "interrupted",
  }, null, 2));
} finally {
  if (session.threadId) {
    await session.client.request("thread/delete", { threadId: session.threadId }).catch(() => undefined);
  }
  session.close();
}
