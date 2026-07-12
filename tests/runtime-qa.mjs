import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const clientModule = process.env.QA_CLIENT_MODULE
  ? pathToFileURL(process.env.QA_CLIENT_MODULE).href
  : new URL("../dist-lib/client.js", import.meta.url).href;
const elementModule = process.env.QA_ELEMENT_MODULE
  ? pathToFileURL(process.env.QA_ELEMENT_MODULE).href
  : new URL("../dist-lib/element.js", import.meta.url).href;
const reactModule = process.env.QA_REACT_MODULE
  ? pathToFileURL(process.env.QA_REACT_MODULE).href
  : new URL("../dist-lib/react.js", import.meta.url).href;

const clientApi = await import(clientModule);
const elementApi = await import(elementModule);
const reactApi = await import(reactModule);
assert.equal(typeof elementApi.defineCodexChatElement, "function");
assert.equal(typeof reactApi.CodexChatEmbed, "function");
assert.equal(clientApi.DEFAULT_CODEX_BRIDGE_URL, "http://127.0.0.1:4174");
assert.equal(clientApi.codexBridgeWebSocketUrl(), "ws://127.0.0.1:4174/ws");

const marker = `RUNTIME_DEFAULT_${Date.now()}`;
const session = clientApi.createCodexSession({ cwd: "/tmp", reconnectMs: false });
try {
  const result = await session.send(`Reply with exactly: ${marker}`);
  assert.equal(result.text.trim(), marker);
  console.log(JSON.stringify({
    nodeWebSocket: typeof WebSocket,
    ssrImports: ["client", "element", "react"],
    defaultBridgeUrl: clientApi.DEFAULT_CODEX_BRIDGE_URL,
    threadId: result.threadId,
    response: result.text.trim(),
  }, null, 2));
} finally {
  if (session.threadId) {
    await session.client.request("thread/delete", { threadId: session.threadId }).catch(() => undefined);
  }
  session.close();
}
