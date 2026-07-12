import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createCodexAssistant } from "../dist-lib/assistant.js";
import { runDoctor } from "../dist-lib/doctor.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "bin/cli.mjs");
const fixture = await realpath(await mkdtemp(resolve(tmpdir(), "t3-platform-runtime-")));
const fakeCodex = resolve(fixture, "fake-codex.mjs");
const launcher = process.platform === "win32"
  ? resolve(fixture, "fake-codex.cmd")
  : fakeCodex;
let lifecycle;

try {
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  console.log("codex-cli platform-smoke");
  process.exit(0);
}
if (process.argv[2] !== "app-server") process.exit(2);

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  const write = (payload) => process.stdout.write(JSON.stringify(payload) + "\\n");
  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    const turnId = "platform-turn";
    const text = "PLATFORM_LIFECYCLE_OK";
    write({ id: message.id, result: { turn: { id: turnId } } });
    write({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress" } } });
    write({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "platform-message", delta: text } });
    write({ method: "item/completed", params: { threadId, turnId, item: { id: "platform-message", type: "agentMessage", text } } });
    write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    return;
  }
  const result = message.method === "account/read"
    ? { account: { type: "platform-smoke" }, requiresOpenaiAuth: false }
    : message.method === "model/list"
      ? { data: [{ model: "platform-smoke", displayName: "Platform Smoke", isDefault: true }] }
      : message.method === "thread/list"
        ? { data: [] }
        : message.method === "thread/start"
          ? { thread: { id: "platform-thread" } }
        : {};
  write({ id: message.id, result });
});
`);
  if (process.platform === "win32") {
    await writeFile(launcher, `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`);
  } else {
    await chmod(fakeCodex, 0o755);
  }

  const report = await runDoctor({ binary: launcher, cwd: fixture, timeoutMs: 5_000 });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.checks.codexBinary.detail, "codex-cli platform-smoke");
  assert.match(report.checks.account.detail, /platform-smoke/);
  assert.match(report.checks.models.detail, /Platform Smoke/);

  const setup = runCli([
    "setup",
    "--mode", "custom",
    "--delivery", "hosted",
    "--port", "auto",
    "--allow-origin", "https://platform-smoke.example",
    "--codex", launcher,
    "--json",
  ], fixture);
  assert.equal(setup.status, 0, setup.stderr || setup.stdout);
  const receipt = JSON.parse(setup.stdout);
  lifecycle = receipt.lifecycle;
  assert.equal(receipt.ok, true);
  assert.equal(receipt.bridge.status, "ready");
  assert.equal(receipt.bridge.cwd, fixture);
  assert.equal(receipt.bridge.codexBinary, launcher);
  assert.equal(receipt.integration.delivery, "hosted");
  assert.equal(lifecycle.resolvedPort, receipt.bridge.port);
  assert.equal(lifecycle.requiredBeforeBrowser, true);

  const firstTurn = await liveTurn(receipt.bridge.url);
  const status = runCli(lifecycle.status.installed.args, lifecycle.status.installed.cwd);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(JSON.parse(status.stdout).status, "ready");

  const stopped = runCli(lifecycle.stop.installed.args, lifecycle.stop.installed.cwd);
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  assert.equal(JSON.parse(stopped.stdout).stopped, true);

  const restarted = runCli(lifecycle.ensure.installed.args, lifecycle.ensure.installed.cwd);
  assert.equal(restarted.status, 0, restarted.stderr || restarted.stdout);
  const restartReceipt = JSON.parse(restarted.stdout);
  assert.equal(restartReceipt.started, true);
  assert.equal(restartReceipt.port, receipt.bridge.port);
  assert.equal(restartReceipt.cwd, fixture);
  const secondTurn = await liveTurn(receipt.bridge.url);

  console.log(JSON.stringify({
    platform: process.platform,
    launcher: process.platform === "win32" ? ".cmd" : "executable script",
    versionInvocation: true,
    appServerHandshake: true,
    accountRead: true,
    modelList: true,
    threadList: true,
    cleanStop: true,
    setupReceipt: true,
    detachedBridge: true,
    streamedTurn: firstTurn,
    statusReceipt: true,
    lifecycleStop: true,
    lifecycleRestart: true,
    postRestartTurn: secondTurn,
  }, null, 2));
} finally {
  if (lifecycle) runCli(lifecycle.stop.installed.args, lifecycle.stop.installed.cwd);
  // Windows may briefly retain the batch shim or script handle after cmd.exe
  // and its child have exited. fs.rm's bounded retry is specifically designed
  // for transient EBUSY/EPERM directory cleanup on that platform.
  await rm(fixture, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 20 : 0,
    retryDelay: 50,
  });
}

async function liveTurn(bridgeUrl) {
  const assistant = createCodexAssistant({
    bridgeUrl,
    reconnectMs: false,
    WebSocketImpl: WebSocket,
  });
  try {
    const deltas = [];
    const answer = await assistant.send("Platform lifecycle smoke", {
      onDelta: (delta) => deltas.push(delta),
    });
    assert.equal(answer.text, "PLATFORM_LIFECYCLE_OK");
    assert.equal(deltas.join(""), "PLATFORM_LIFECYCLE_OK");
    await assistant.client.request("thread/delete", { threadId: answer.threadId });
    return answer.text;
  } finally {
    await assistant.close();
  }
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}
