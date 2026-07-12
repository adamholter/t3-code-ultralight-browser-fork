import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { chromium } from "playwright";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = process.env.QA_CLI ?? fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const bridgePort = Number(process.env.QA_BRIDGE_PORT ?? await reservePort());
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;
const bridgeSocketOrigin = `ws://127.0.0.1:${bridgePort}`;
const hostProtocol = process.env.QA_HOST_PROTOCOL ?? "https";
if (!["http", "https"].includes(hostProtocol)) throw new Error("QA_HOST_PROTOCOL must be http or https");
const marker = `EXTERNAL_ORIGIN_${Date.now()}`;
const embedMarker = `EXTERNAL_EMBED_${Date.now()}`;
let recipe;
const tls = hostProtocol === "https" ? await createTestCertificate() : null;

const hostHandler = (request, response) => {
  if (request.url === "/app.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(`
      import { createCodexEmbedController, subscribeCodexEmbedEvents } from ${JSON.stringify(`${bridgeOrigin}/codex-embed.js`)};
      let streamedText = "";
      const yourUI = {
        reviewApproval: async () => false,
        ask: async () => ({}),
        renderStreamingText: (text) => { streamedText = text; },
      };
      const prompt = ${JSON.stringify(`Reply with exactly: ${marker}`)};
      ${recipe?.code ?? "throw new Error('Setup recipe was not ready')"}
      const externalOriginResult = {
        text: answer.text.trim(),
        streamed: streamedText.includes(${JSON.stringify(marker)}),
        threadId: answer.threadId,
      };
      const iframe = document.querySelector("#controlled-chat");
      const embedCompleted = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("External embed turn timed out")), 120000);
        const unsubscribe = subscribeCodexEmbedEvents(iframe, (event) => {
          if (event.event !== "turn" || event.phase !== "completed") return;
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        });
      });
      const embedController = createCodexEmbedController(iframe);
      const embedAccepted = await embedController.send(${JSON.stringify(`Reply with exactly: ${embedMarker}`)}, { cwd: "/tmp", newThread: true });
      const embedTurn = await embedCompleted;
      externalOriginResult.embed = {
        accepted: embedAccepted.ok,
        command: embedAccepted.command,
        threadId: embedAccepted.threadId,
        turnId: embedAccepted.turnId,
        completedThreadId: embedTurn.threadId,
      };
      window.__externalOriginResult = externalOriginResult;
      await codex.client.request("thread/delete", { threadId: embedAccepted.threadId });
      embedController.dispose();
      await codex.close();
    `);
    return;
  }
  if (request.url === "/evil.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(`
      const moduleRejected = await import(${JSON.stringify(`${bridgeOrigin}/codex-client.js`)})
        .then(() => false, () => true);
      const websocketRejected = await new Promise((resolve) => {
        const socket = new WebSocket(${JSON.stringify(`${bridgeSocketOrigin}/ws`)});
        const timeout = setTimeout(() => { socket.close(); resolve(false); }, 3000);
        socket.addEventListener("open", () => { clearTimeout(timeout); socket.close(); resolve(false); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timeout); resolve(true); }, { once: true });
      });
      const iframe = document.querySelector("#controlled-chat");
      await new Promise((resolve) => {
        iframe.addEventListener("load", resolve, { once: true });
        setTimeout(resolve, 3000);
      });
      const requestId = "evil-command";
      const commandRejected = await new Promise((resolve) => {
        const listener = (event) => {
          if (event.source !== iframe.contentWindow || event.data?.event !== "command" || event.data?.requestId !== requestId) return;
          window.removeEventListener("message", listener);
          resolve(false);
        };
        window.addEventListener("message", listener);
        iframe.contentWindow.postMessage({
          source: "t3-code-ultralight",
          version: 1,
          direction: "host-command",
          requestId,
          command: "newThread",
        }, ${JSON.stringify(bridgeOrigin)});
        setTimeout(() => {
          window.removeEventListener("message", listener);
          resolve(true);
        }, 750);
      });
      window.__evilOriginResult = { moduleRejected, websocketRejected, commandRejected };
    `);
    return;
  }
  const isEvil = request.headers.host?.startsWith("evil.example.test:");
  response.writeHead(200, {
    "content-security-policy": `default-src 'none'; script-src 'self' ${bridgeOrigin}; connect-src ${bridgeSocketOrigin}; frame-src ${bridgeOrigin};`,
    "content-type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>External origin QA</title><iframe id="controlled-chat" src="${bridgeOrigin}/?embed=1" title="Controlled Codex"></iframe><script type="module" src="${isEvil ? "/evil.js" : "/app.js"}"></script>`);
};
const host = tls
  ? createHttpsServer({ key: tls.key, cert: tls.cert }, hostHandler)
  : createHttpServer(hostHandler);

host.listen(0, "127.0.0.1");
await once(host, "listening");
const hostPort = host.address().port;
const allowedOrigin = `${hostProtocol}://app.example.test:${hostPort}`;
const evilOrigin = `${hostProtocol}://evil.example.test:${hostPort}`;
let bridgeStarted = false;
let browser;

try {
  const setup = runCli([
    "setup",
    "--mode", "custom",
    "--delivery", "hosted",
    "--port", String(bridgePort),
    "--allow-origin", allowedOrigin,
    "--cwd", "/tmp",
    "--json",
  ]);
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  const setupReport = JSON.parse(setup.stdout);
  assert.equal(setupReport.ok, true);
  assert.deepEqual(setupReport.bridge.allowedOrigins, [allowedOrigin]);
  assert.equal(setupReport.integration.requiresPackageInstall, false);
  assert.deepEqual(setupReport.integration.originPolicy, {
    bridgeSelfOriginAutomatic: true,
    loopbackAutomatic: false,
    broadLoopbackOptInFlag: "--allow-loopback-origins",
    additionalAllowedOrigins: [allowedOrigin],
    opaqueOriginAllowed: false,
    browserHostRequiresExactFlag: "--allow-origin <exact browser origin>",
    nonLoopbackRequiresExactFlag: "--allow-origin <exact browser origin>",
  });
  recipe = setupReport.integration;
  bridgeStarted = true;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-proxy-server",
      ...(hostProtocol === "https" ? ["--ignore-certificate-errors"] : []),
      "--host-resolver-rules=MAP app.example.test 127.0.0.1, MAP evil.example.test 127.0.0.1",
    ],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const moduleResponses = new Map();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if ([recipe.hostedModules.assistant, recipe.hostedModules.client, recipe.hostedModules.requests, `${bridgeOrigin}/codex-embed.js`].includes(response.url())) {
      moduleResponses.set(response.url(), response);
    }
  });
  await page.goto(allowedOrigin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__externalOriginResult, null, { timeout: 30_000 });
  const allowed = await page.evaluate(() => window.__externalOriginResult);
  const corsExact = [...moduleResponses.values()].every((response) =>
    response.status() === 200
    && response.headers()["access-control-allow-origin"] === allowedOrigin
    && response.headers().vary === "Origin"
  );
  assert.equal(moduleResponses.size, 2);
  assert.equal(moduleResponses.has(recipe.hostedModules.assistant), true);
  assert.equal(corsExact, true);
  assert.equal(allowed.text, marker);
  assert.equal(allowed.streamed, true);
  assert.equal(typeof allowed.threadId, "string");
  assert.equal(allowed.embed.accepted, true);
  assert.equal(allowed.embed.command, "send");
  assert.equal(typeof allowed.embed.threadId, "string");
  assert.equal(typeof allowed.embed.turnId, "string");
  assert.equal(allowed.embed.completedThreadId, allowed.embed.threadId);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);

  const evilPage = await browser.newPage();
  await evilPage.goto(evilOrigin, { waitUntil: "domcontentloaded" });
  await evilPage.waitForFunction(() => window.__evilOriginResult, null, { timeout: 10_000 });
  const rejected = await evilPage.evaluate(() => window.__evilOriginResult);
  assert.deepEqual(rejected, { moduleRejected: true, websocketRejected: true, commandRejected: true });

  console.log(JSON.stringify({
    allowedOrigin,
    hostProtocol,
    configuredOrigins: setupReport.bridge.allowedOrigins,
    exactCors: corsExact,
    websocketAllowed: true,
    response: allowed.text,
    streamed: allowed.streamed,
    disposed: true,
    embedHostCommand: allowed.embed,
    rejectedOrigin: evilOrigin,
    rejectedModule: rejected.moduleRejected,
    rejectedWebSocket: rejected.websocketRejected,
    rejectedEmbedCommand: rejected.commandRejected,
    consoleErrors,
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close();
  if (bridgeStarted) {
    const stop = runCli(["stop", "--port", String(bridgePort), "--json"]);
    if (stop.status !== 0) process.stderr.write(stop.stderr || stop.stdout);
  }
  await new Promise((resolve) => host.close(resolve));
  if (tls) await rm(tls.directory, { recursive: true, force: true });
}

function runCli(args) {
  return spawnSync(cli, args, { encoding: "utf8" });
}

async function reservePort() {
  const probe = createHttpServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function createTestCertificate() {
  const directory = await mkdtemp(resolve(tmpdir(), "t3-ultralight-tls-"));
  const keyPath = resolve(directory, "key.pem");
  const certPath = resolve(directory, "cert.pem");
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath,
    "-out", certPath,
    "-days", "1",
    "-subj", "/CN=app.example.test",
    "-addext", "subjectAltName=DNS:app.example.test,DNS:evil.example.test",
  ], { encoding: "utf8" });
  if (generated.status !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(generated.stderr || generated.stdout || "Unable to create QA TLS certificate");
  }
  return {
    directory,
    key: await readFile(keyPath),
    cert: await readFile(certPath),
  };
}
