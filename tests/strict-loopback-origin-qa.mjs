import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "bin/cli.mjs");
let bridgePort;
const marker = `STRICT_LOOPBACK_${Date.now()}`;

const host = createServer((request, response) => {
  if (request.url === "/good.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(`
      import { createCodexAssistant } from ${JSON.stringify(`__BRIDGE__/codex-assistant.js`)};
      const assistant = createCodexAssistant({ bridgeUrl: ${JSON.stringify("__BRIDGE__")}, reconnectMs: false });
      const answer = await assistant.send(${JSON.stringify(`Reply with exactly: ${marker}`)});
      await assistant.client.request("thread/delete", { threadId: answer.threadId });
      await assistant.close();
      window.__strictGood = { text: answer.text.trim(), threadId: answer.threadId };
    `.replaceAll("__BRIDGE__", `http://127.0.0.1:${bridgePort}`));
    return;
  }
  if (request.url === "/evil.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(`
      const moduleRejected = await import(${JSON.stringify(`__BRIDGE__/codex-assistant.js`)})
        .then(() => false, () => true);
      const websocketRejected = await new Promise((resolve) => {
        const socket = new WebSocket(${JSON.stringify(`ws://127.0.0.1:__PORT__/ws`)});
        socket.onopen = () => { socket.close(); resolve(false); };
        socket.onerror = () => resolve(true);
      });
      window.__strictEvil = { moduleRejected, websocketRejected };
    `.replaceAll("__BRIDGE__", `http://127.0.0.1:${bridgePort}`).replaceAll("__PORT__", String(bridgePort)));
    return;
  }
  const isEvil = request.headers.host?.startsWith("localhost:");
  response.writeHead(200, {
    "content-security-policy": `default-src 'none'; script-src 'self' http://127.0.0.1:${bridgePort}; connect-src ws://127.0.0.1:${bridgePort}; frame-src http://127.0.0.1:${bridgePort};`,
    "content-type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html><meta charset="utf-8"><iframe title="Codex" src="http://127.0.0.1:${bridgePort}/?embed=1"></iframe><script type="module" src="/${isEvil ? "evil" : "good"}.js"></script>`);
});

host.listen(0, "127.0.0.1");
await once(host, "listening");
const hostPort = host.address().port;
const allowedOrigin = `http://127.0.0.1:${hostPort}`;
const siblingOrigin = `http://localhost:${hostPort}`;
const setup = run(["setup", "--mode", "custom", "--delivery", "hosted", "--port", "auto", "--allow-origin", allowedOrigin, "--json"]);
assert.equal(setup.status, 0, setup.stderr || setup.stdout);
const receipt = JSON.parse(setup.stdout);
bridgePort = receipt.bridge.port;
assert.equal(receipt.bridge.allowLoopbackOrigins, false);
assert.deepEqual(receipt.bridge.allowedOrigins, [allowedOrigin]);
assert.equal(receipt.integration.originPolicy.bridgeSelfOriginAutomatic, true);
assert.equal(receipt.integration.originPolicy.loopbackAutomatic, false);
assert.equal(receipt.lifecycle.ensure.installed.args.includes("--allow-loopback-origins"), false);

const browser = await chromium.launch({ headless: true });
const goodPage = await browser.newPage();
const evilPage = await browser.newPage();
const selfPage = await browser.newPage();
const goodErrors = [];
goodPage.on("pageerror", (error) => goodErrors.push(error.message));

try {
  await goodPage.goto(allowedOrigin, { waitUntil: "domcontentloaded" });
  await goodPage.waitForFunction(() => window.__strictGood, null, { timeout: 30_000 });
  const good = await goodPage.evaluate(() => window.__strictGood);
  assert.equal(good.text, marker);
  assert.deepEqual(goodErrors, []);
  assert.equal(goodPage.frames().some((frame) => frame.url().startsWith(receipt.bridge.url)), true);

  await evilPage.goto(siblingOrigin, { waitUntil: "domcontentloaded" });
  await evilPage.waitForFunction(() => window.__strictEvil, null, { timeout: 10_000 });
  assert.deepEqual(await evilPage.evaluate(() => window.__strictEvil), {
    moduleRejected: true,
    websocketRejected: true,
  });
  await evilPage.waitForTimeout(250);
  assert.equal(evilPage.frames().some((frame) => frame.url().startsWith(receipt.bridge.url)), false);

  await selfPage.goto(receipt.bridge.url, { waitUntil: "domcontentloaded" });
  await selfPage.locator(".status-dot.ready").waitFor({ timeout: 10_000 });

  console.log(JSON.stringify({
    exactAllowedOrigin: allowedOrigin,
    rejectedSiblingLoopbackOrigin: siblingOrigin,
    moduleRejected: true,
    websocketRejected: true,
    iframeRejected: true,
    bridgeSelfOriginAutomatic: true,
    liveResponse: good.text,
    broadLoopbackOptIn: false,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => host.close(resolveClose));
  run(["stop", "--port", String(bridgePort), "--json"]);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}
