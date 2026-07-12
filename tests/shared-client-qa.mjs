import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const clientModule = process.env.QA_CLIENT_MODULE
  ? pathToFileURL(process.env.QA_CLIENT_MODULE).href
  : new URL("../dist-lib/client.js", import.meta.url).href;
const { createCodexClient, createCodexSession } = await import(clientModule);

let socketCount = 0;
class CountingWebSocket extends WebSocket {
  constructor(...args) {
    super(...args);
    socketCount += 1;
  }
}

const client = createCodexClient({
  ...(process.env.QA_BASE_URL ? { bridgeUrl: process.env.QA_BASE_URL } : {}),
  WebSocketImpl: CountingWebSocket,
  reconnectMs: false,
  requiredCapabilities: ["requestOwnership", "threadIsolation"],
});
const canvas = createCodexSession({ client, cwd: "/tmp" });
const voice = createCodexSession({ client, cwd: "/tmp" });
const canvasMarker = `SHARED_CANVAS_${Date.now()}`;
const voiceMarker = `SHARED_VOICE_${Date.now()}`;
const canvasDeltas = [];
const voiceDeltas = [];

try {
  const [canvasResult, voiceResult] = await Promise.all([
    canvas.send(`Reply with exactly: ${canvasMarker}`, { onDelta: (delta) => canvasDeltas.push(delta) }),
    voice.send(`Reply with exactly: ${voiceMarker}`, { onDelta: (delta) => voiceDeltas.push(delta) }),
  ]);
  assert.equal(canvasResult.text.trim(), canvasMarker);
  assert.equal(voiceResult.text.trim(), voiceMarker);
  assert.notEqual(canvasResult.threadId, voiceResult.threadId);
  assert.ok(canvasDeltas.join("").includes(canvasMarker));
  assert.ok(voiceDeltas.join("").includes(voiceMarker));
  assert.equal(canvasDeltas.join("").includes(voiceMarker), false);
  assert.equal(voiceDeltas.join("").includes(canvasMarker), false);
  assert.equal(socketCount, 1);

  await canvas.close();
  const followup = await voice.send("Reply with exactly: SHARED_VOICE_STILL_CONNECTED");
  assert.equal(followup.text.trim(), "SHARED_VOICE_STILL_CONNECTED");
  assert.equal(socketCount, 1);
  await voice.close();
  const models = await client.listModels();
  assert.ok(models.data.length > 0);
  assert.equal(socketCount, 1);

  console.log(JSON.stringify({
    socketCount,
    canvasThreadId: canvasResult.threadId,
    voiceThreadId: voiceResult.threadId,
    isolatedDeltas: true,
    siblingClosePreservedClient: true,
    modelCountAfterSessionClose: models.data.length,
  }, null, 2));
} finally {
  for (const threadId of [canvas.threadId, voice.threadId]) {
    if (threadId) await client.request("thread/delete", { threadId }).catch(() => undefined);
  }
  await canvas.close();
  await voice.close();
  client.close();
}
