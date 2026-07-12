import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexSession } from "../dist-lib/client.js";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const cliPackage = process.env.QA_PACKAGE ? resolve(process.env.QA_PACKAGE) : null;
const firstWorkspace = await realpath(await mkdtemp(resolve(tmpdir(), "t3-auto-first-")));
const secondWorkspace = await realpath(await mkdtemp(resolve(tmpdir(), "t3-auto-second-")));
const startedPorts = new Set();
const defaultPortBlocker = await occupyDefaultPortIfAvailable();
const marker = `AUTO_PORT_${Date.now()}`;
let session;

try {
  const first = setup(firstWorkspace);
  assert.equal(first.ok, true);
  assert.equal(first.bridge.portSelection, "auto");
  assert.notEqual(first.bridge.port, 4174);
  assert.equal(first.bridge.cwd, firstWorkspace);
  assert.equal(first.integration.bridgeUrl, first.bridge.url);
  assert.equal(first.integration.statusUrl, `${first.bridge.url}/api/status`);
  assert.equal(first.bridge.started, true);
  startedPorts.add(first.bridge.port);

  const repeated = setup(firstWorkspace);
  assert.equal(repeated.bridge.port, first.bridge.port);
  assert.equal(repeated.bridge.reused, true);
  assert.equal(repeated.bridge.started, false);
  assert.equal(repeated.bridge.portSelection, "auto");

  const second = setup(secondWorkspace);
  assert.notEqual(second.bridge.port, 4174);
  assert.notEqual(second.bridge.port, first.bridge.port);
  assert.equal(second.bridge.cwd, secondWorkspace);
  assert.equal(second.bridge.portSelection, "auto");
  startedPorts.add(second.bridge.port);

  session = createCodexSession({ bridgeUrl: first.bridge.url, reconnectMs: false });
  const answer = await session.send(`Reply with exactly: ${marker}`);
  assert.equal(answer.text.trim(), marker);
  const resumed = await session.client.request("thread/resume", { threadId: answer.threadId });
  assert.equal(resumed.cwd, firstWorkspace);
  await session.client.request("thread/delete", { threadId: answer.threadId });
  await session.close();
  session = null;

  const status = runCli(["status", "--port", String(first.bridge.port), "--json"], firstWorkspace);
  assert.equal(status.status, 0);
  const statusReport = JSON.parse(status.stdout);
  assert.match(statusReport.workspaceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(statusReport).includes(firstWorkspace), false);

  console.log(JSON.stringify({
    packagePath: cliPackage ?? "workspace source",
    defaultPortOccupied: true,
    firstPort: first.bridge.port,
    repeatedPort: repeated.bridge.port,
    repeatReused: repeated.bridge.reused,
    secondPort: second.bridge.port,
    deterministicWorkspaceIsolation: true,
    liveResponse: answer.text.trim(),
    inheritedWorkspace: resumed.cwd,
    firstIntegrationUrl: first.integration.integrationUrl,
  }, null, 2));
} finally {
  await session?.close().catch(() => undefined);
  for (const port of startedPorts) {
    const stopped = runCli(["stop", "--port", String(port), "--json"], firstWorkspace);
    if (stopped.status !== 0) process.stderr.write(stopped.stderr || stopped.stdout);
  }
  if (defaultPortBlocker) await new Promise((resolveClose) => defaultPortBlocker.close(resolveClose));
  await rm(firstWorkspace, { recursive: true, force: true });
  await rm(secondWorkspace, { recursive: true, force: true });
}

function setup(cwd) {
  const result = runCli(["setup", "--mode", "custom", "--delivery", "hosted", "--port", "auto", "--json"], cwd);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runCli(args, cwd) {
  if (cliPackage) {
    return spawnSync("npx", ["--yes", "--package", cliPackage, "t3-code-ultralight", ...args], {
      cwd,
      encoding: "utf8",
    });
  }
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

async function occupyDefaultPortIfAvailable() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "auto-port-test-blocker" }));
  });
  const listening = await new Promise((resolveListening) => {
    server.once("error", () => resolveListening(false));
    server.listen(4174, "127.0.0.1", () => resolveListening(true));
  });
  return listening ? server : null;
}
