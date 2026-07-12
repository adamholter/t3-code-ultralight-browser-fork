import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCodexAssistant } from "../dist-lib/assistant.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "bin/cli.mjs");
const workspace = await realpath(await mkdtemp(resolve(tmpdir(), "t3-lifecycle-")));
let lifecycle;

try {
  const setup = run(["setup", "--mode", "custom", "--delivery", "hosted", "--port", "auto", "--allow-origin", "http://127.0.0.1:39003", "--json"], workspace);
  assert.equal(setup.status, 0, setup.stderr || setup.stdout);
  const receipt = JSON.parse(setup.stdout);
  lifecycle = receipt.lifecycle;
  assert.equal(lifecycle.requiredBeforeBrowser, true);
  assert.equal(lifecycle.runFrom, workspace);
  assert.equal(lifecycle.resolvedPort, receipt.bridge.port);
  assert.equal(lifecycle.resolvedPortStable, true);
  assert.deepEqual(lifecycle.ensure.installed.args.slice(0, 3), ["start", "--port", String(receipt.bridge.port)]);
  assert.equal(lifecycle.ensure.installed.args.includes("--codex"), true);
  assert.equal(lifecycle.ensure.installed.args.includes("--allow-origin"), true);
  assert.equal(lifecycle.ensure.installed.args.includes("http://127.0.0.1:39003"), true);
  assert.equal(lifecycle.ensure.installed.args.includes("--allow-loopback-origins"), false);
  assert.equal(lifecycle.ensure.zeroInstall.command, "npx");
  assert.equal(lifecycle.ensure.zeroInstall.args.includes(receipt.integration.bridgeUrl), false);

  const first = await liveTurn(receipt.bridge.url, `LIFECYCLE_BEFORE_${Date.now()}`);

  const stopped = run(lifecycle.stop.installed.args, lifecycle.stop.installed.cwd);
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  assert.equal(JSON.parse(stopped.stdout).stopped, true);
  await assert.rejects(fetch(receipt.bridge.url, { signal: AbortSignal.timeout(500) }));

  const ensured = run(lifecycle.ensure.installed.args, lifecycle.ensure.installed.cwd);
  assert.equal(ensured.status, 0, ensured.stderr || ensured.stdout);
  const restarted = JSON.parse(ensured.stdout);
  assert.equal(restarted.port, receipt.bridge.port);
  assert.equal(restarted.cwd, workspace);
  assert.equal(restarted.codexBinary, receipt.bridge.codexBinary);
  assert.equal(restarted.started, true);

  const status = run(lifecycle.status.installed.args, lifecycle.status.installed.cwd);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(JSON.parse(status.stdout).status, "ready");
  const second = await liveTurn(receipt.bridge.url, `LIFECYCLE_AFTER_${Date.now()}`);

  console.log(JSON.stringify({
    exactPort: receipt.bridge.port,
    runFrom: lifecycle.runFrom,
    packageCommandAvailable: true,
    zeroInstallCommandAvailable: true,
    stoppedCleanly: true,
    restartedExactPort: true,
    firstResponse: first,
    postRestartResponse: second,
  }, null, 2));
} finally {
  if (lifecycle) run(lifecycle.stop.installed.args, lifecycle.stop.installed.cwd);
  await rm(workspace, { recursive: true, force: true });
}

async function liveTurn(bridgeUrl, marker) {
  const assistant = createCodexAssistant({ bridgeUrl, reconnectMs: false });
  try {
    const answer = await assistant.send(`Reply with exactly: ${marker}`);
    assert.equal(answer.text.trim(), marker);
    await assistant.client.request("thread/delete", { threadId: answer.threadId });
    return answer.text.trim();
  } finally {
    await assistant.close();
  }
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}
