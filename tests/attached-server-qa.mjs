import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import WebSocket from "ws";
import { createCodexClient } from "../dist-lib/client.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workingDirectory = await realpath(await mkdtemp(resolve(tmpdir(), "t3-attached-host-")));
const packagePath = process.env.QA_PACKAGE
  ? resolve(process.env.QA_PACKAGE)
  : await packWorkspace(resolve(workingDirectory, "pack"));
const fixture = resolve(workingDirectory, "host");
const marker = `ATTACHED_SERVER_${Date.now()}`;
const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const socketUrl = `ws://127.0.0.1:${port}/internal/codex/ws`;
let host;
let browser;
let threadCleaned = false;

try {
  await mkdir(fixture, { recursive: true });
  await writeFile(resolve(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  const installed = spawnSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", packagePath, "ws@8.18.3",
  ], { cwd: fixture, encoding: "utf8" });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);

  await writeFile(resolve(fixture, "server.mjs"), attachedHostServerSource());
  host = spawn(process.execPath, ["server.mjs"], {
    cwd: fixture,
    env: { ...process.env, PORT: String(port), HOST_WORKSPACE: workingDirectory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let hostOutput = "";
  host.stdout.on("data", (chunk) => { hostOutput += chunk; });
  host.stderr.on("data", (chunk) => { hostOutput += chunk; });
  const initialHealth = await waitForHealth(host, () => hostOutput);
  assert.equal(initialHealth.hostListening, true);
  assert.equal(initialHealth.bridgeReady, true);
  assert.equal(initialHealth.upgradeListeners, 2);
  assert.deepEqual(initialHealth.bridgeListeners, { notification: 1, request: 1, ready: 1, exit: 1 });
  assert.equal(await fetch(`${origin}/host-route`).then((response) => response.text()), "host route intact");
  assert.equal((await fetch(`${origin}/internal/codex/ws`)).status, 404);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.__attachedHost?.ready === true, null, { timeout: 30_000 });
  } catch (error) {
    throw new Error(`Attached browser host did not become ready: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ consoleErrors, pageErrors, hostOutput }, null, 2)}`);
  }
  await page.getByRole("button", { name: "Ask attached Codex" }).click();
  await page.getByTestId("response").getByText(marker, { exact: true }).waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => window.__attachedHost?.disposed === true, null, { timeout: 30_000 });
  const browserResult = await page.evaluate(() => window.__attachedHost);
  assert.equal(browserResult.text, marker);
  assert.equal(browserResult.streamed.includes(marker), true);
  assert.equal(browserResult.cwd, workingDirectory);
  assert.equal(browserResult.hostEcho, "host-pong");
  assert.equal(browserResult.threadDeleted, true);
  threadCleaned = true;
  assert.equal(browserResult.bridgeInfo.protocol.major, 1);
  assert.ok(browserResult.bridgeInfo.capabilities.includes("threadIsolation"));
  assert.ok(browserResult.bridgeInfo.capabilities.includes("requestOwnership"));

  await page.screenshot({ path: "/tmp/codex-web-attached-server-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const hostOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-attached-server-mobile.png", fullPage: true });
  assert.equal(hostOverflow, false);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);

  const stubbornSocket = new WebSocket(socketUrl);
  stubbornSocket.on("error", () => {});
  await once(stubbornSocket, "open");
  stubbornSocket._socket.pause();
  const stopStartedAt = Date.now();
  const firstStop = await fetch(`${origin}/api/codex/stop`, { method: "POST" }).then((response) => response.json());
  const stopElapsedMs = Date.now() - stopStartedAt;
  stubbornSocket._socket.resume();
  stubbornSocket.terminate();
  const secondStop = await fetch(`${origin}/api/codex/stop`, { method: "POST" }).then((response) => response.json());
  assert.deepEqual(firstStop, secondStop);
  assert.equal(firstStop.stopped, true);
  assert.equal(firstStop.hostListening, true);
  assert.equal(firstStop.upgradeListeners, 1);
  assert.ok(stopElapsedMs >= 60 && stopElapsedMs < 500, `Attached stop was not bounded as expected: ${stopElapsedMs} ms`);
  assert.deepEqual(firstStop.bridgeListeners, { notification: 0, request: 0, ready: 0, exit: 0 });
  assert.equal(await fetch(`${origin}/host-route`).then((response) => response.text()), "host route intact");
  assert.equal(await page.evaluate(() => window.__attachedHost.openHostSocket()), "host-pong");
  assert.equal(await probeSocketOpen(socketUrl), false);
  const restart = await fetch(`${origin}/api/codex/restart`, { method: "POST" }).then((response) => response.json());
  assert.equal(restart.ok, false);
  assert.match(restart.error, /controller has been stopped/);

  console.log(JSON.stringify({
    packagePath,
    customSocketPath: "/internal/codex/ws",
    hostRoutesPreserved: true,
    hostWebSocketBeforeAndAfter: true,
    streamed: browserResult.streamed.includes(marker),
    response: browserResult.text,
    workspace: browserResult.cwd,
    threadDeleted: browserResult.threadDeleted,
    protocol: browserResult.bridgeInfo.protocol,
    capabilities: browserResult.bridgeInfo.capabilities,
    idempotentStop: firstStop === secondStop || JSON.stringify(firstStop) === JSON.stringify(secondStop),
    nonCooperativeSocketStopMs: stopElapsedMs,
    listenersReleased: firstStop.bridgeListeners,
    hostStillListening: firstStop.hostListening,
    restartRejected: true,
    hostOverflow,
    consoleErrors,
    pageErrors,
  }, null, 2));
  await page.close();
} finally {
  await browser?.close();
  if (!threadCleaned) await cleanupMarkerThread().catch(() => undefined);
  if (host?.exitCode === null) {
    host.kill("SIGTERM");
    await Promise.race([once(host, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    if (host.exitCode === null) host.kill("SIGKILL");
  }
  await rm(workingDirectory, { recursive: true, force: true });
}

function attachedHostServerSource() {
  return `
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { attachCodexBridge } from "t3-code-ultralight-browser-fork/server";

const clientModule = fileURLToPath(import.meta.resolve("t3-code-ultralight-browser-fork/client"));
const requestModule = fileURLToPath(import.meta.resolve("t3-code-ultralight-browser-fork/requests"));
const hostSockets = new WebSocketServer({ noServer: true });
hostSockets.on("connection", (socket) => socket.on("message", (message) => socket.send(message.toString() === "host-ping" ? "host-pong" : "unknown")));
let controller;

const server = createServer(async (request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(${JSON.stringify(attachedHostHtml())});
    return;
  }
  if (request.url === "/app.js") {
    response.writeHead(200, { "cache-control": "no-store", "content-type": "text/javascript; charset=utf-8", "x-content-type-options": "nosniff" });
    response.end(${JSON.stringify(attachedHostAppSource({ marker, socketUrl }))});
    return;
  }
  if (request.url === "/codex-client.js" || request.url === "/codex-requests.js") {
    response.writeHead(200, { "cache-control": "no-store", "content-type": "text/javascript; charset=utf-8", "x-content-type-options": "nosniff" });
    createReadStream(request.url === "/codex-client.js" ? clientModule : requestModule).pipe(response);
    return;
  }
  if (request.url === "/host-route") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("host route intact");
    return;
  }
  if (request.url === "/api/health") {
    sendJson(response, health());
    return;
  }
  if (request.url === "/api/codex/stop" && request.method === "POST") {
    await controller.stop();
    sendJson(response, { stopped: true, ...health() });
    return;
  }
  if (request.url === "/api/codex/restart" && request.method === "POST") {
    try {
      await controller.start();
      sendJson(response, { ok: true });
    } catch (error) {
      sendJson(response, { ok: false, error: error.message });
    }
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("host 404");
});

server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/host-ws") return;
  hostSockets.handleUpgrade(request, socket, head, (webSocket) => hostSockets.emit("connection", webSocket, request));
});
controller = attachCodexBridge(server, {
  path: "/internal/codex/ws",
  cwd: process.env.HOST_WORKSPACE,
  autoStart: false,
  browserSocketCloseTimeoutMs: 80,
});
await controller.start();
server.listen(Number(process.env.PORT), "127.0.0.1");

function health() {
  return {
    hostListening: server.listening,
    bridgeReady: controller.bridge.ready,
    upgradeListeners: server.listenerCount("upgrade"),
    bridgeListeners: Object.fromEntries(["notification", "request", "ready", "exit"].map((event) => [event, controller.bridge.listenerCount(event)])),
  };
}
function sendJson(response, value) {
  response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(value));
}
process.on("SIGTERM", async () => {
  await controller.stop().catch(() => undefined);
  for (const socket of hostSockets.clients) socket.terminate();
  hostSockets.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2_000).unref();
});
`;
}

function attachedHostHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attached Codex host</title><style>
    *{box-sizing:border-box}html,body{margin:0;min-width:0;min-height:100%;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:#eef0f3;color:#202124}main{display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px;width:min(100%,860px);height:100dvh;margin:auto;padding:20px}header{display:flex;align-items:baseline;justify-content:space-between;gap:12px}header span,#status{color:#6f737a}section{min-width:0;min-height:0;border:1px solid #d4d6da;border-radius:11px;padding:18px;background:white}button{width:fit-content;border:1px solid #cfd2d7;border-radius:7px;padding:8px 11px;background:#fff;color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}pre{min-width:0;min-height:180px;margin:14px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}@media(max-width:520px){main{padding:8px}header{align-items:flex-start;flex-direction:column}section{padding:13px}}
  </style></head><body><main><header><strong>Existing Node server</strong><span>Attached local Codex</span></header><section><div id="status">Connecting…</div><button disabled>Ask attached Codex</button><pre data-testid="response"></pre></section></main><script type="module" src="/app.js"></script></body></html>`;
}

function attachedHostAppSource({ marker, socketUrl }) {
  return `
import { createCodexSession } from "/codex-client.js";
import { attachCodexSessionRequestHandlers } from "/codex-requests.js";

const status = document.querySelector("#status");
const button = document.querySelector("button");
const output = document.querySelector("[data-testid=response]");
window.__attachedHost = {
  ready: false, text: "", streamed: "", cwd: null, hostEcho: null, disposed: false, threadDeleted: false,
  openHostSocket,
};
const session = createCodexSession({
  url: ${JSON.stringify(socketUrl)},
  reconnectMs: false,
  requiredCapabilities: ["requestOwnership", "threadIsolation", "transportLimits"],
});
const detach = attachCodexSessionRequestHandlers(session, {
  approval: () => "decline",
  userInput: () => ({}),
});
await session.client.connect();
window.__attachedHost.bridgeInfo = session.client.bridgeInfo;
window.__attachedHost.hostEcho = await openHostSocket();
window.__attachedHost.ready = true;
status.textContent = "Attached bridge ready";
button.disabled = false;
button.addEventListener("click", async () => {
  button.disabled = true;
  const result = await session.send(${JSON.stringify(`Reply with exactly: ${marker}`)}, {
    onDelta: (_delta, text) => {
      window.__attachedHost.streamed = text;
      output.textContent = text;
    },
  });
  const resumed = await session.client.request("thread/resume", { threadId: result.threadId });
  window.__attachedHost.text = result.text.trim();
  window.__attachedHost.cwd = resumed.cwd;
  output.textContent = window.__attachedHost.text;
  await session.client.request("thread/delete", { threadId: result.threadId });
  window.__attachedHost.threadDeleted = true;
  detach();
  await session.close();
  window.__attachedHost.disposed = true;
  status.textContent = "Turn complete and session disposed";
});

function openHostSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(location.origin.replace(/^http/, "ws") + "/host-ws");
    socket.addEventListener("open", () => socket.send("host-ping"));
    socket.addEventListener("message", (event) => { const value = event.data; socket.close(); resolve(value); });
    socket.addEventListener("error", () => reject(new Error("Host WebSocket failed")));
  });
}
`;
}

function probeSocketOpen(url) {
  return new Promise((resolveProbe) => {
    const socket = new WebSocket(url);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.terminate();
      resolveProbe(value);
    };
    socket.once("open", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    setTimeout(() => finish(false), 500);
  });
}

async function cleanupMarkerThread() {
  if (!host || host.exitCode !== null) return;
  const client = createCodexClient({ url: socketUrl, reconnectMs: false });
  try {
    await client.connect();
    const page = await client.request("thread/list", { limit: 50, sortKey: "recency_at", sortDirection: "desc" });
    for (const thread of page.data ?? []) if (thread.preview?.includes(marker)) await client.request("thread/delete", { threadId: thread.id });
  } finally {
    client.close();
  }
}

async function packWorkspace(directory) {
  await mkdir(directory, { recursive: true });
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", directory], { cwd: root, encoding: "utf8" });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const tarballs = (await readdir(directory)).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  return resolve(directory, tarballs[0]);
}

async function waitForHealth(child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Attached host exited early.\n${output()}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Attached host did not become ready.\n${output()}`);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const selectedPort = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return selectedPort;
}
