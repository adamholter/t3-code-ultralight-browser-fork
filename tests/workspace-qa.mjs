import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createCodexClient } from "../dist-lib/client.js";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const cliPackage = process.env.QA_PACKAGE ? resolve(process.env.QA_PACKAGE) : null;
const directory = await realpath(await mkdtemp(resolve(tmpdir(), "t3-fresh-project-")));
const otherDirectory = await realpath(await mkdtemp(resolve(tmpdir(), "t3-other-project-")));
const port = await reservePort();
const bridgeOrigin = `http://127.0.0.1:${port}`;
const marker = `FRESH_WORKSPACE_${Date.now()}`;
const customMarker = `FRESH_RECIPE_${Date.now()}`;
let bridgeStarted = false;
let browser;
let client;
let recipeHost;

try {
  const setup = runCli(["setup", "--mode", "iframe", "--port", String(port), "--json"], directory);
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  const report = JSON.parse(setup.stdout);
  bridgeStarted = true;
  assert.equal(report.ok, true);
  assert.equal(report.bridge.cwd, directory);
  assert.equal(report.bridge.started, true);
  assert.equal(report.integration.mode, "iframe");
  assert.equal(report.integration.requiresPackageInstall, false);
  assert.deepEqual(report.integration.workspace, { default: "bridge", overrideEmbedded: false });
  assert.equal(report.integration.controllerCode.includes(directory), false);
  assert.equal(report.integration.code.includes(directory), false);
  assert.equal(JSON.stringify(report.integration).includes(directory), false);

  const customSetup = runCli([
    "setup", "--mode", "custom", "--delivery", "hosted", "--port", String(port), "--json",
  ], directory);
  if (customSetup.status !== 0) throw new Error(customSetup.stderr || customSetup.stdout);
  const customReport = JSON.parse(customSetup.stdout);
  assert.equal(customReport.bridge.reused, true);
  assert.deepEqual(customReport.integration.workspace, { default: "bridge", overrideEmbedded: false });
  assert.equal(customReport.integration.code.includes(directory), false);
  assert.equal(JSON.stringify(customReport.integration).includes(directory), false);

  const explicitSetup = runCli([
    "setup", "--mode", "custom", "--delivery", "hosted", "--port", String(port), "--cwd", directory, "--json",
  ], otherDirectory);
  if (explicitSetup.status !== 0) throw new Error(explicitSetup.stderr || explicitSetup.stdout);
  const explicitReport = JSON.parse(explicitSetup.stdout);
  assert.equal(explicitReport.bridge.cwd, directory);
  assert.equal(explicitReport.bridge.reused, true);
  assert.deepEqual(explicitReport.integration.workspace, { default: "bridge", overrideEmbedded: false });
  assert.equal(JSON.stringify(explicitReport.integration).includes(directory), false);

  const status = await fetch(`${bridgeOrigin}/api/status`).then((response) => response.json());
  assert.equal(status.workspaceFingerprint, fingerprint(directory));
  assert.equal("cwd" in status, false);
  assert.equal("workspaceCwd" in status, false);
  assert.equal(JSON.stringify(status).includes(directory), false);
  const mismatched = runCli(["start", "--port", String(port), "--json"], otherDirectory);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /different default workspace/);

  client = createCodexClient({ url: `ws://127.0.0.1:${port}/ws`, reconnectMs: false });
  await client.connect();

  browser = await chromium.launch({ headless: true });
  recipeHost = createServer((request, response) => {
    if (request.url === "/app.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(`
        let streamedText = "";
        const yourUI = {
          reviewApproval: async () => false,
          ask: async () => ({}),
          renderStreamingText: (text) => { streamedText = text; },
        };
        const prompt = ${JSON.stringify(`Reply with exactly: ${customMarker}`)};
        ${customReport.integration.code}
        window.__recipeResult = { text: answer.text.trim(), streamedText, threadId: answer.threadId };
        await codex.close();
      `);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><meta charset="utf-8"><script type="module" src="/app.js"></script>');
  });
  recipeHost.listen(0, "127.0.0.1");
  await once(recipeHost, "listening");
  const recipePage = await browser.newPage();
  const recipeErrors = [];
  recipePage.on("console", (message) => { if (message.type() === "error") recipeErrors.push(message.text()); });
  recipePage.on("pageerror", (error) => recipeErrors.push(error.message));
  await recipePage.goto(`http://127.0.0.1:${recipeHost.address().port}`, { waitUntil: "domcontentloaded" });
  await recipePage.waitForFunction(() => window.__recipeResult, null, { timeout: 120_000 });
  const recipeResult = await recipePage.evaluate(() => window.__recipeResult);
  assert.equal(recipeResult.text, customMarker);
  assert.ok(recipeResult.streamedText.includes(customMarker));
  assert.deepEqual(recipeErrors, []);
  await recipePage.close();

  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(`${bridgeOrigin}/?embed=1`, { waitUntil: "domcontentloaded" });
  await page.locator(".status-dot.ready, .composer").first().waitFor({ timeout: 20_000 });

  const input = page.getByLabel("Working directory");
  const initial = {
    value: await input.inputValue(),
    placeholder: await input.getAttribute("placeholder"),
    subtitle: await page.locator(".thread-heading span").innerText(),
  };
  assert.deepEqual(initial, { value: "", placeholder: "Bridge workspace", subtitle: "Bridge workspace" });

  await page.getByLabel("Message Codex").fill(`Reply with exactly: ${marker}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  try {
    await page.locator(".assistant-message").getByText(marker, { exact: false }).waitFor({ timeout: 120_000 });
  } catch (error) {
    await page.screenshot({ path: "/tmp/codex-web-fresh-workspace-timeout.png", fullPage: true }).catch(() => undefined);
    const recent = await client.request("thread/list", { limit: 100, sortKey: "recency_at", sortDirection: "desc" }).catch(() => ({ data: [] }));
    const matchingThreads = recent.data
      .filter((entry) => entry.preview?.includes(marker) || entry.preview?.includes(customMarker))
      .map((entry) => ({ id: entry.id, preview: entry.preview, status: entry.status }));
    const diagnostics = {
      consoleErrors,
      matchingThreads,
      working: await page.locator(".working").count(),
      assistantMessages: await page.locator(".assistant-message").count(),
    };
    throw new Error(`Fresh-workspace browser turn did not render: ${error instanceof Error ? error.message : String(error)}; diagnostics=${JSON.stringify(diagnostics)}`);
  }
  await page.locator(".working").waitFor({ state: "detached", timeout: 120_000 });
  const activeSubtitle = await page.locator(".thread-heading span").innerText();
  assert.equal(activeSubtitle, directory);
  await page.screenshot({ path: "/tmp/codex-web-fresh-workspace-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(mobileOverflow, false);
  const userBubbleOverflow = await page.locator(".user-copy").evaluate((element) => element.scrollWidth > element.clientWidth);
  assert.equal(userBubbleOverflow, false);
  const mobileLayout = await page.evaluate(() => {
    const app = document.querySelector(".app-shell")?.getBoundingClientRect();
    const workspace = document.querySelector(".workspace")?.getBoundingClientRect();
    const conversation = document.querySelector(".conversation")?.getBoundingClientRect();
    const bubble = document.querySelector(".user-copy")?.getBoundingClientRect();
    const timeline = document.querySelector(".timeline")?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      app: app && { x: app.x, width: app.width, right: app.right },
      workspace: workspace && { x: workspace.x, width: workspace.width, right: workspace.right },
      conversation: conversation && { x: conversation.x, width: conversation.width, right: conversation.right },
      bubble: bubble && { x: bubble.x, width: bubble.width, right: bubble.right },
      timeline: timeline && { x: timeline.x, width: timeline.width, right: timeline.right },
    };
  });
  assert.ok(
    mobileLayout.bubble && mobileLayout.bubble.x >= 0 && mobileLayout.bubble.right <= mobileLayout.clientWidth,
    `User bubble escaped mobile viewport: ${JSON.stringify(mobileLayout)}`,
  );
  await page.screenshot({ path: "/tmp/codex-web-fresh-workspace-mobile.png", fullPage: true });
  assert.deepEqual(consoleErrors, []);

  const threadPage = await client.request("thread/list", { limit: 20, sortKey: "recency_at", sortDirection: "desc" });
  const thread = threadPage.data.find((entry) => entry.preview?.includes(marker));
  const recipeThread = threadPage.data.find((entry) => entry.preview?.includes(customMarker));
  assert.ok(thread?.id);
  assert.ok(recipeThread?.id);
  const resumed = await client.request("thread/resume", { threadId: thread.id });
  const resumedRecipe = await client.request("thread/resume", { threadId: recipeThread.id });
  assert.equal(resumed.cwd, directory);
  assert.equal(resumedRecipe.cwd, directory);
  await client.request("thread/delete", { threadId: thread.id });
  await client.request("thread/delete", { threadId: recipeThread.id });

  console.log(JSON.stringify({
    setupCwd: report.bridge.cwd,
    explicitCwdFlag: false,
    cliSource: cliPackage ? "packed release" : "workspace source",
    initialBrowserWorkspace: initial.subtitle,
    firstTurnWorkspace: resumed.cwd,
    workspaceFingerprintOnly: true,
    generatedRecipeHidesWorkspacePath: true,
    generatedRecipeInheritedWorkspace: resumedRecipe.cwd,
    generatedRecipeStreamed: true,
    explicitBridgeOverrideRemainsPathFree: true,
    mismatchedWorkspaceRejected: true,
    response: marker,
    mobileOverflow,
    userBubbleOverflow,
    userBubbleRight: Math.round(mobileLayout.bubble.right),
    consoleErrors,
  }, null, 2));
} finally {
  if (client) await deleteMarkerThreads(client, [marker, customMarker]).catch(() => undefined);
  client?.close();
  await browser?.close();
  if (recipeHost?.listening) await new Promise((resolveClose) => recipeHost.close(resolveClose));
  if (bridgeStarted) {
    const stopped = runCli(["stop", "--port", String(port), "--json"], directory);
    if (stopped.status !== 0) process.stderr.write(stopped.stderr || stopped.stdout);
  }
  await rm(directory, { recursive: true, force: true });
  await rm(otherDirectory, { recursive: true, force: true });
}

async function deleteMarkerThreads(codex, markers) {
  const page = await codex.request("thread/list", { limit: 100, sortKey: "recency_at", sortDirection: "desc" });
  for (const thread of page.data ?? []) {
    if (!markers.some((value) => thread.preview?.includes(value))) continue;
    await codex.request("thread/delete", { threadId: thread.id }).catch(() => undefined);
  }
}

function runCli(args, cwd) {
  if (cliPackage) {
    return spawnSync("npx", ["--yes", "--package", cliPackage, "t3-code-ultralight", ...args], { cwd, encoding: "utf8" });
  }
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function fingerprint(cwd) {
  return createHash("sha256").update(cwd).digest("hex");
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
