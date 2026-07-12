import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runDoctor } from "../dist-lib/doctor.js";

const fixture = await mkdtemp(resolve(tmpdir(), "t3-platform-runtime-"));
const fakeCodex = resolve(fixture, "fake-codex.mjs");
const launcher = process.platform === "win32"
  ? resolve(fixture, "fake-codex.cmd")
  : fakeCodex;

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
  const result = message.method === "account/read"
    ? { account: { type: "platform-smoke" }, requiresOpenaiAuth: false }
    : message.method === "model/list"
      ? { data: [{ model: "platform-smoke", displayName: "Platform Smoke", isDefault: true }] }
      : message.method === "thread/list"
        ? { data: [] }
        : {};
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
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

  console.log(JSON.stringify({
    platform: process.platform,
    launcher: process.platform === "win32" ? ".cmd" : "executable script",
    versionInvocation: true,
    appServerHandshake: true,
    accountRead: true,
    modelList: true,
    threadList: true,
    cleanStop: true,
  }, null, 2));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
