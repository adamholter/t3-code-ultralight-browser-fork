import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = process.env.QA_CLI ?? fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const bridgePort = Number(process.env.QA_BRIDGE_PORT ?? await reservePort());
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;
const bridgeSocketOrigin = `ws://127.0.0.1:${bridgePort}`;
const marker = `FILE_ORIGIN_${Date.now()}`;
const embedMarker = `FILE_EMBED_${Date.now()}`;
const directory = await mkdtemp(resolve(tmpdir(), "t3-ultralight-file-origin-"));
let bridgeStarted = false;
let browser;

try {
  const setup = runCli([
    "setup",
    "--mode", "custom",
    "--delivery", "hosted",
    "--port", String(bridgePort),
    "--allow-origin", "null",
    "--cwd", "/tmp",
    "--json",
  ]);
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  const setupReport = JSON.parse(setup.stdout);
  assert.equal(setupReport.ok, true);
  assert.deepEqual(setupReport.bridge.allowedOrigins, ["null"]);
  assert.deepEqual(setupReport.integration.originPolicy, {
    loopbackAutomatic: true,
    additionalAllowedOrigins: ["null"],
    opaqueOriginAllowed: true,
    nonLoopbackRequiresExactFlag: "--allow-origin <exact browser origin>",
  });
  bridgeStarted = true;
  const recipe = setupReport.integration;
  const filePath = resolve(directory, "codex-tool.html");
  await writeFile(filePath, `<!doctype html>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${bridgeOrigin}; connect-src ${bridgeSocketOrigin}; frame-src ${bridgeOrigin};">
    <title>File origin Codex tool</title>
    <iframe id="controlled-chat" src="${bridgeOrigin}/?embed=1" title="Controlled Codex"></iframe>
    <script type="module">
      window.__fileOriginStage = "module-started";
      window.__fileOriginEmbedEvents = [];
      import { createCodexEmbedController, subscribeCodexEmbedEvents } from ${JSON.stringify(`${bridgeOrigin}/codex-embed.js`)};
      let streamedText = "";
      const yourUI = {
        reviewApproval: async () => false,
        ask: async () => ({}),
        renderStreamingText: (text) => { streamedText = text; },
      };
      const prompt = ${JSON.stringify(`Reply with exactly: ${marker}`)};
      ${recipe.code}
      window.__fileOriginStage = "headless-completed";
      const fileOriginResult = {
        text: answer.text.trim(),
        streamed: streamedText.includes(${JSON.stringify(marker)}),
        threadId: answer.threadId,
      };
      const iframe = document.querySelector("#controlled-chat");
      const embedCompleted = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("File embed turn timed out")), 120000);
        const unsubscribe = subscribeCodexEmbedEvents(iframe, (event) => {
          window.__fileOriginEmbedEvents.push(event);
          if (event.event !== "turn" || event.phase !== "completed") return;
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        });
      });
      const embedController = createCodexEmbedController(iframe);
      window.__fileOriginStage = "embed-sending";
      const embedAccepted = await embedController.send(${JSON.stringify(`Reply with exactly: ${embedMarker}`)}, { cwd: "/tmp", newThread: true });
      window.__fileOriginStage = "embed-accepted";
      const embedTurn = await embedCompleted;
      window.__fileOriginStage = "embed-completed";
      fileOriginResult.embed = {
        accepted: embedAccepted.ok,
        threadId: embedAccepted.threadId,
        turnId: embedAccepted.turnId,
        completedThreadId: embedTurn.threadId,
      };
      await codex.client.request("thread/delete", { threadId: embedAccepted.threadId });
      embedController.dispose();
      window.__fileOriginResult = fileOriginResult;
      await codex.close();
    </script>`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const moduleResponses = new Map();
  let iframeResponse;
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url() === `${bridgeOrigin}/?embed=1`) iframeResponse = response;
    if ([recipe.hostedModules.assistant, recipe.hostedModules.client, recipe.hostedModules.requests, `${bridgeOrigin}/codex-embed.js`].includes(response.url())) {
      moduleResponses.set(response.url(), response);
    }
  });
  await page.goto(pathToFileURL(filePath).href, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.__fileOriginResult, null, { timeout: 120_000 });
  } catch (cause) {
    const diagnostics = await page.evaluate(() => ({
      stage: window.__fileOriginStage,
      embedEvents: window.__fileOriginEmbedEvents,
      frameUrl: document.querySelector("#controlled-chat")?.src,
      frameText: document.querySelector("#controlled-chat")?.contentDocument?.body?.innerText?.slice(0, 500),
    })).catch((error) => ({ diagnosticError: error.message }));
    throw new Error(`${cause.message}; diagnostics=${JSON.stringify({ diagnostics, consoleErrors, pageErrors })}`);
  }
  const result = await page.evaluate(() => window.__fileOriginResult);
  const nullCors = [...moduleResponses.values()].every((response) =>
    response.status() === 200
    && response.headers()["access-control-allow-origin"] === "null"
    && response.headers().vary === "Origin"
  );
  assert.equal(moduleResponses.size, 2);
  assert.equal(moduleResponses.has(recipe.hostedModules.assistant), true);
  assert.equal(nullCors, true);
  assert.equal(result.text, marker);
  assert.equal(result.streamed, true);
  assert.equal(typeof result.threadId, "string");
  assert.equal(result.embed.accepted, true);
  assert.equal(typeof result.embed.threadId, "string");
  assert.equal(typeof result.embed.turnId, "string");
  assert.equal(result.embed.completedThreadId, result.embed.threadId);
  assert.equal(iframeResponse?.headers()["content-security-policy"]?.includes("frame-ancestors * file:"), true);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    pageOrigin: "null",
    pageUrl: "file://.../codex-tool.html",
    configuredOrigins: setupReport.bridge.allowedOrigins,
    exactCors: nullCors,
    websocketAllowed: true,
    response: result.text,
    streamed: result.streamed,
    disposed: true,
    embedHostCommand: result.embed,
    explicitFileFraming: true,
    consoleErrors,
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close();
  if (bridgeStarted) {
    const stop = runCli(["stop", "--port", String(bridgePort), "--json"]);
    if (stop.status !== 0) process.stderr.write(stop.stderr || stop.stdout);
  }
  await rm(directory, { recursive: true, force: true });
}

function runCli(args) {
  return spawnSync(cli, args, { encoding: "utf8" });
}

async function reservePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
