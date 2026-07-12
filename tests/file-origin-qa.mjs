import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const cli = process.env.QA_CLI ?? fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const bridgePort = Number(process.env.QA_BRIDGE_PORT ?? await reservePort());
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;
const bridgeSocketOrigin = `ws://127.0.0.1:${bridgePort}`;
const marker = `FILE_ORIGIN_${Date.now()}`;
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${bridgeOrigin}; connect-src ${bridgeSocketOrigin};">
    <title>File origin Codex tool</title>
    <script type="module">
      let streamedText = "";
      const yourUI = {
        reviewApproval: async () => false,
        ask: async () => ({}),
        renderStreamingText: (text) => { streamedText = text; },
      };
      const prompt = ${JSON.stringify(`Reply with exactly: ${marker}`)};
      ${recipe.code}
      window.__fileOriginResult = {
        text: answer.text.trim(),
        streamed: streamedText.includes(${JSON.stringify(marker)}),
        threadId: answer.threadId,
      };
      detachRequests();
      await codex.close();
    </script>`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const moduleResponses = new Map();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if ([recipe.hostedModules.client, recipe.hostedModules.requests].includes(response.url())) {
      moduleResponses.set(response.url(), response);
    }
  });
  await page.goto(pathToFileURL(filePath).href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__fileOriginResult, null, { timeout: 30_000 });
  const result = await page.evaluate(() => window.__fileOriginResult);
  const nullCors = [...moduleResponses.values()].every((response) =>
    response.status() === 200
    && response.headers()["access-control-allow-origin"] === "null"
    && response.headers().vary === "Origin"
  );
  assert.equal(moduleResponses.size, 2);
  assert.equal(nullCors, true);
  assert.equal(result.text, marker);
  assert.equal(result.streamed, true);
  assert.equal(typeof result.threadId, "string");
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
