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
const directory = await realpath(await mkdtemp(resolve(tmpdir(), "t3-fresh-project-")));
const otherDirectory = await realpath(await mkdtemp(resolve(tmpdir(), "t3-other-project-")));
const port = await reservePort();
const bridgeOrigin = `http://127.0.0.1:${port}`;
const marker = `FRESH_WORKSPACE_${Date.now()}`;
let bridgeStarted = false;
let browser;
let client;

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
  assert.ok(report.integration.controllerCode.includes(JSON.stringify(directory)));

  const status = await fetch(`${bridgeOrigin}/api/status`).then((response) => response.json());
  assert.equal(status.workspaceFingerprint, fingerprint(directory));
  assert.equal("cwd" in status, false);
  assert.equal("workspaceCwd" in status, false);
  assert.equal(JSON.stringify(status).includes(directory), false);
  const mismatched = runCli(["start", "--port", String(port), "--json"], otherDirectory);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /different default workspace/);

  browser = await chromium.launch({ headless: true });
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
  await page.locator(".assistant-message").getByText(marker, { exact: false }).waitFor({ timeout: 120_000 });
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

  client = createCodexClient({ url: `ws://127.0.0.1:${port}/ws`, reconnectMs: false });
  await client.connect();
  const threadPage = await client.request("thread/list", { limit: 20, sortKey: "recency_at", sortDirection: "desc" });
  const thread = threadPage.data.find((entry) => entry.preview?.includes(marker));
  assert.ok(thread?.id);
  const resumed = await client.request("thread/resume", { threadId: thread.id });
  assert.equal(resumed.cwd, directory);
  await client.request("thread/delete", { threadId: thread.id });

  console.log(JSON.stringify({
    setupCwd: report.bridge.cwd,
    explicitCwdFlag: false,
    initialBrowserWorkspace: initial.subtitle,
    firstTurnWorkspace: resumed.cwd,
    workspaceFingerprintOnly: true,
    controllerRecipeUsesWorkspace: true,
    mismatchedWorkspaceRejected: true,
    response: marker,
    mobileOverflow,
    userBubbleOverflow,
    userBubbleRight: Math.round(mobileLayout.bubble.right),
    consoleErrors,
  }, null, 2));
} finally {
  client?.close();
  await browser?.close();
  if (bridgeStarted) {
    const stopped = runCli(["stop", "--port", String(port), "--json"], directory);
    if (stopped.status !== 0) process.stderr.write(stopped.stderr || stopped.stdout);
  }
  await rm(directory, { recursive: true, force: true });
  await rm(otherDirectory, { recursive: true, force: true });
}

function runCli(args, cwd) {
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
