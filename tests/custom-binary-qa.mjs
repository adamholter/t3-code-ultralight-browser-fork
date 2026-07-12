import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "bin/cli.mjs");
const fixture = await mkdtemp(resolve(tmpdir(), "t3-custom-binary-"));
const wrapper = resolve(fixture, "codex-wrapper.mjs");
const calls = resolve(fixture, "calls.jsonl");
const realCodex = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
let port;

try {
  await writeFile(wrapper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const child = spawn(${JSON.stringify(realCodex)}, process.argv.slice(2), { stdio: "inherit" });
child.once("error", (error) => { console.error(error.message); process.exit(1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
`);
  await chmod(wrapper, 0o755);

  const setup = run(["setup", "--mode", "custom", "--delivery", "hosted", "--port", "auto", "--codex", wrapper, "--cwd", root, "--json"]);
  assert.equal(setup.status, 0, setup.stderr || setup.stdout);
  const receipt = JSON.parse(setup.stdout);
  port = receipt.bridge.port;
  assert.notEqual(port, 4174, "custom binary must not reuse the default-binary bridge");
  assert.equal(receipt.bridge.codexBinary, wrapper);

  const status = await fetch(`${receipt.bridge.url}/api/status`).then((response) => response.json());
  assert.equal(status.codexBinaryFingerprint, fingerprint(wrapper));
  assert.equal("codexBinary" in status, false);

  const { createCodexAssistant } = await import(new URL("../dist-lib/assistant.js", import.meta.url));
  const assistant = createCodexAssistant({ bridgeUrl: receipt.bridge.url });
  const marker = `CUSTOM_BINARY_${Date.now()}`;
  const answer = await assistant.send(`Reply with exactly: ${marker}`);
  assert.equal(answer.text.trim(), marker);
  await assistant.client.request("thread/delete", { threadId: answer.threadId });
  await assistant.close();

  const repeated = run(["start", "--port", String(port), "--codex", wrapper, "--cwd", root, "--json"]);
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.equal(JSON.parse(repeated.stdout).reused, true);

  const mismatch = run(["start", "--port", String(port), "--cwd", root, "--json"]);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /different Codex binary/);

  const invocations = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(invocations.some((args) => args.includes("--version")), true);
  assert.equal(invocations.some((args) => args[0] === "app-server" && args[1] === "--stdio"), true);

  console.log(JSON.stringify({
    customBinaryPropagated: true,
    binaryPathHiddenFromBrowser: true,
    defaultBridgePreserved: true,
    resolvedPort: port,
    repeatedStartReused: true,
    mismatchedBinaryRejected: true,
    liveResponse: answer.text.trim(),
    wrapperInvocations: invocations.length,
  }, null, 2));
} finally {
  if (port) run(["stop", "--port", String(port), "--json"]);
  await rm(fixture, { recursive: true, force: true });
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}
