#!/usr/bin/env node

import { accessSync, closeSync, constants, mkdtempSync, openSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_NAME = "t3-code-ultralight-browser-fork";
const DEFAULT_PORT = 4174;
const AUTO_PORT_MIN = 42_000;
const AUTO_PORT_SPAN = 18_000;
const AUTO_PORT_ATTEMPTS = 64;
const commandOptions = {
  setup: { values: ["--port", "--allow-origin", "--mode", "--delivery", "--codex", "--cwd"], repeatable: ["--allow-origin"], booleans: ["--reuse-origin-superset", "--json"] },
  start: { values: ["--port", "--allow-origin", "--codex", "--cwd"], repeatable: ["--allow-origin"], booleans: ["--reuse-origin-superset", "--json"] },
  serve: { values: ["--port", "--allow-origin", "--codex", "--cwd"], repeatable: ["--allow-origin"], booleans: ["--reuse-origin-superset"] },
  status: { values: ["--port"], repeatable: [], booleans: ["--json"] },
  stop: { values: ["--port"], repeatable: [], booleans: ["--json"] },
  doctor: { values: ["--codex", "--cwd"], repeatable: [], booleans: ["--json"] },
  integration: { values: [], repeatable: [], booleans: [] },
  "agent-prompt": { values: [], repeatable: [], booleans: [] },
};
const { version: packageVersion } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2] ?? "serve";
  if (["help", "--help", "-h"].includes(command)) {
    printHelp();
    return;
  }
  validateCommandArgs(command, process.argv.slice(3));

  if (command === "serve") {
    const requestedPort = parsePort(valueAfter("--port"), true);
    const workspaceCwd = resolveWorkspaceCwd(valueAfter("--cwd"));
    const codexBinary = normalizeCodexBinary(valueAfter("--codex"));
    const allowedOrigins = unique(valuesAfter("--allow-origin").map(normalizeOrigin));
    const reuseOriginSuperset = process.argv.includes("--reuse-origin-superset");
    const port = requestedPort === "auto" ? await selectAutoPort(allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) : requestedPort;
    const existing = await readBridgeStatus(port);
    if (existing) {
      assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
      console.log(`Codex bridge v${existing.version} is already ${existing.status} at ${bridgeUrl(port)}${existing.pid ? ` (PID ${existing.pid})` : ""}.`);
      return;
    }
    process.env.PORT = String(port);
    process.env.CODEX_WORKSPACE_CWD = workspaceCwd;
    process.env.CODEX_BINARY = codexBinary;
    if (allowedOrigins.length) process.env.CODEX_ALLOWED_ORIGINS = JSON.stringify(allowedOrigins);
    process.env.NODE_ENV = "production";
    await import("../dist-lib/standalone.js");
    return;
  }

  if (command === "setup") {
    const requestedPort = parsePort(valueAfter("--port"), true);
    const workspaceCwd = resolveWorkspaceCwd(valueAfter("--cwd"));
    const codexBinary = normalizeCodexBinary(valueAfter("--codex"));
    const mode = parseSetupMode(valueAfter("--mode"));
    const delivery = parseSetupDelivery(valueAfter("--delivery"), mode);
    const allowedOrigins = unique(valuesAfter("--allow-origin").map(normalizeOrigin));
    const reuseOriginSuperset = process.argv.includes("--reuse-origin-superset");
    const { runDoctor } = await import("../dist-lib/doctor.js");
    const doctor = await runDoctor({
      binary: codexBinary,
      cwd: workspaceCwd,
    });
    if (!doctor.ok) {
      const report = { ok: false, mode, delivery, doctor, bridge: null, lifecycle: null, integration: null };
      printSetupReport(report);
      process.exitCode = 1;
      return;
    }

    const port = requestedPort === "auto" ? await selectAutoPort(allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) : requestedPort;

    const contract = JSON.parse(await readFile(new URL("../integration.json", import.meta.url), "utf8"));
    const { createIntegrationRecipe } = await import("../dist-lib/integration.js");
    const integration = createIntegrationRecipe(contract, {
      mode,
      delivery,
      port,
      allowedOrigins,
    });
    const started = await ensureBackgroundBridge(port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
    const bridge = createStartReport(started.status, port, started.reused, started.logPath, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
    const lifecycle = createLifecycleReport(contract.release.specifier, port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
    printSetupReport({ ok: true, mode, delivery, doctor, bridge, lifecycle, integration });
    return;
  }

  if (command === "start") {
    const requestedPort = parsePort(valueAfter("--port"), true);
    const workspaceCwd = resolveWorkspaceCwd(valueAfter("--cwd"));
    const codexBinary = normalizeCodexBinary(valueAfter("--codex"));
    const allowedOrigins = unique(valuesAfter("--allow-origin").map(normalizeOrigin));
    const reuseOriginSuperset = process.argv.includes("--reuse-origin-superset");
    const port = requestedPort === "auto" ? await selectAutoPort(allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) : requestedPort;
    const started = await ensureBackgroundBridge(port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
    printStartReport(started.status, port, started.reused, started.logPath, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
    return;
  }

  if (command === "status") {
    const port = parsePort(valueAfter("--port"));
    const status = await readBridgeStatus(port);
    const report = status
      ? { running: true, url: bridgeUrl(port), ...status }
      : { running: false, url: bridgeUrl(port), version: null, status: "offline", pid: null, allowedOrigins: [], workspaceFingerprint: null, codexBinaryFingerprint: null, protocol: null, capabilities: [], browserModules: [] };
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else if (status) {
      console.log(`Codex bridge v${status.version} is ${status.status} at ${bridgeUrl(port)}${status.pid ? ` (PID ${status.pid})` : ""}.`);
      if (status.protocol) console.log(`Browser protocol: ${status.protocol.major}.${status.protocol.minor}`);
      if (status.browserModules.length) console.log(`Hosted browser modules: ${status.browserModules.join(", ")}`);
      console.log(`Allowed browser origins: ${status.allowedOrigins.length ? status.allowedOrigins.join(", ") : "loopback only"}`);
    } else {
      console.log(`No Codex bridge is running at ${bridgeUrl(port)}.`);
    }
    if (!status) process.exitCode = 1;
    return;
  }

  if (command === "stop") {
    const port = parsePort(valueAfter("--port"));
    const status = await readBridgeStatus(port);
    if (!status) {
      const report = { stopped: false, running: false, url: bridgeUrl(port), pid: null, version: null };
      if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else console.log(`No Codex bridge is running at ${bridgeUrl(port)}.`);
      return;
    }
    if (!status.pid) {
      throw new Error(`The Codex bridge at ${bridgeUrl(port)} did not report a process ID and cannot be stopped safely.`);
    }
    try {
      process.kill(status.pid, "SIGTERM");
    } catch (cause) {
      if (cause?.code !== "ESRCH") throw cause;
    }
    if (!(await waitForBridgeStop(port, status.pid))) {
      throw new Error(`Codex bridge PID ${status.pid} did not stop within 5 seconds. Check ${bridgeUrl(port)}/api/status before taking further action.`);
    }
    const report = { stopped: true, running: false, url: bridgeUrl(port), pid: status.pid, version: status.version };
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else console.log(`Stopped Codex bridge v${status.version} at ${bridgeUrl(port)} (PID ${status.pid}).`);
    return;
  }

  if (command === "doctor") {
    const { runDoctor } = await import("../dist-lib/doctor.js");
    const report = await runDoctor({
      binary: valueAfter("--codex"),
      cwd: resolveWorkspaceCwd(valueAfter("--cwd")),
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`T3 Code Ultralight doctor\n`);
      for (const [name, check] of Object.entries(report.checks)) {
        console.log(`${check.ok ? "✓" : "✗"} ${name}: ${check.detail}${check.durationMs == null ? "" : ` (${check.durationMs}ms)`}`);
      }
      for (const recommendation of report.recommendations) console.log(`\n→ ${recommendation}`);
      console.log(`\n${report.ok ? "Ready for local Codex integrations." : "Not ready yet."}`);
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "integration") {
    const contract = await readFile(new URL("../integration.json", import.meta.url), "utf8");
    console.log(contract.trim());
    return;
  }

  if (command === "agent-prompt") {
    console.log(`Install https://github.com/adamholter/t3-code-ultralight-browser-fork.
Allow this web app to talk to the user's local Codex.
Use the stable prebuilt release asset linked in the README so installation does not compile the package.
Run the package setup command from the host project's root with --mode iframe, react, element, or custom and JSON output. For element or custom, use --delivery hosted when the tool has no npm/bundler. Follow the verified receipt. Use the complete chat unless the existing UI needs custom rendering; its Web Component, React ref, and raw iframe controller can accept host prompts without DOM access.
Use --port auto when this project should coexist with another local Codex bridge; keep the selected port from the receipt for later status and stop commands.
If Codex is not the default PATH command, pass the same --codex path to setup, start, or serve; bridge reuse is isolated by a path-private binary fingerprint.
Keep the bridge loopback-only. If a custom browser UI or imperative embed host is not on loopback, allow only its exact origin.
Use the idempotent stop command before replacing a bridge for an upgrade or origin change.
Preserve approvals and verify one live turn through the final UI.`);
    return;
  }

  printHelp();
}

function printHelp() {
  console.log(`
t3-code-ultralight

Usage:
  t3-code-ultralight setup [--mode iframe|react|element|custom] [--delivery package|hosted] [--port 4174|auto] [--allow-origin ORIGIN]... [--reuse-origin-superset] [--codex PATH] [--cwd PATH] [--json]
  t3-code-ultralight start [--port 4174|auto] [--allow-origin ORIGIN]... [--reuse-origin-superset] [--codex PATH] [--cwd PATH] [--json]
  t3-code-ultralight serve [--port 4174|auto] [--allow-origin ORIGIN]... [--reuse-origin-superset] [--codex PATH] [--cwd PATH]
  t3-code-ultralight status [--port 4174] [--json]
  t3-code-ultralight stop [--port 4174] [--json]
  t3-code-ultralight doctor [--json] [--codex PATH] [--cwd PATH]
  t3-code-ultralight integration
  t3-code-ultralight agent-prompt

Commands:
  setup         Verify Codex, start the bridge, and print a complete host recipe.
  start         Start in the background, wait for ready, or reuse a compatible bridge.
  serve         Run the loopback bridge in the foreground.
  status        Inspect a running standalone bridge without starting Codex.
  stop          Stop a verified standalone bridge; safe to run repeatedly.
  doctor        Verify the CLI, app-server, login, models, and thread store.
  integration   Print the machine-readable integration contract.
  agent-prompt  Print a ready-to-paste integration prompt.
`);
}

function validateCommandArgs(command, args) {
  const spec = commandOptions[command];
  if (!spec) throw new Error(`Unknown command ${JSON.stringify(command)}. Run \`t3-code-ultralight --help\` for usage.`);
  const values = new Set(spec.values);
  const repeatable = new Set(spec.repeatable);
  const booleans = new Set(spec.booleans);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (values.has(argument)) {
      if (seen.has(argument) && !repeatable.has(argument)) throw new Error(`${argument} may be provided only once.`);
      seen.add(argument);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      continue;
    }
    if (booleans.has(argument)) {
      if (seen.has(argument)) throw new Error(`${argument} may be provided only once.`);
      seen.add(argument);
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option ${JSON.stringify(argument)} for ${command}. Run \`t3-code-ultralight --help\` for usage.`);
    throw new Error(`Unexpected argument ${JSON.stringify(argument)} for ${command}. Run \`t3-code-ultralight --help\` for usage.`);
  }
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function valuesAfter(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== flag) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    values.push(value);
  }
  return values;
}

function parsePort(value, allowAuto = false) {
  if (value === undefined) return DEFAULT_PORT;
  if (allowAuto && value === "auto") return value;
  const recommendation = allowAuto ? "Use auto or an integer from 1 to 65535." : "Use an integer from 1 to 65535.";
  if (!/^\d+$/.test(value)) throw new Error(`Invalid --port ${JSON.stringify(value)}. ${recommendation}`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid --port ${JSON.stringify(value)}. ${recommendation}`);
  }
  return port;
}

async function selectAutoPort(allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) {
  let firstAvailablePort = null;
  for (const port of autoPortCandidates(workspaceCwd)) {
    const existing = await readBridgeStatus(port);
    if (existing) {
      try {
        assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
        return port;
      } catch {
        continue;
      }
    }
    if (firstAvailablePort === null && await canBindLoopbackPort(port)) firstAvailablePort = port;
  }
  if (firstAvailablePort !== null) return firstAvailablePort;
  throw new Error(`Unable to find an available deterministic loopback port after ${AUTO_PORT_ATTEMPTS + 1} attempts. Pass an explicit --port.`);
}

function autoPortCandidates(workspaceCwd) {
  const candidates = [DEFAULT_PORT];
  const seen = new Set(candidates);
  for (let attempt = 0; attempt < AUTO_PORT_ATTEMPTS; attempt += 1) {
    const digest = createHash("sha256").update(`${workspaceCwd}\0${attempt}`).digest();
    const port = AUTO_PORT_MIN + (digest.readUInt32BE(0) % AUTO_PORT_SPAN);
    if (seen.has(port)) continue;
    seen.add(port);
    candidates.push(port);
  }
  return candidates;
}

function canBindLoopbackPort(port) {
  return new Promise((resolveAvailable) => {
    const server = createNetServer();
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      resolveAvailable(available);
    };
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

function parseSetupMode(value) {
  const mode = value ?? "iframe";
  if (!["iframe", "react", "element", "custom"].includes(mode)) {
    throw new Error(`Invalid --mode ${JSON.stringify(mode)}. Use iframe, react, element, or custom.`);
  }
  return mode;
}

function parseSetupDelivery(value, mode) {
  if (value && !["package", "hosted"].includes(value)) {
    throw new Error(`Invalid --delivery ${JSON.stringify(value)}. Use package or hosted.`);
  }
  const delivery = value ?? (mode === "iframe" ? "hosted" : "package");
  if (mode === "iframe" && delivery !== "hosted") {
    throw new Error("iframe integrations support only --delivery hosted");
  }
  if (mode === "react" && delivery !== "package") {
    throw new Error("react integrations support only --delivery package");
  }
  return delivery;
}

function normalizeOrigin(value) {
  const input = value.trim();
  if (input === "null") return input;
  let url;
  try { url = new URL(input); } catch { throw new Error(`Invalid --allow-origin ${JSON.stringify(value)}.`); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Invalid --allow-origin ${JSON.stringify(value)}. Use only scheme, host, and optional port.`);
  }
  return url.origin;
}

function assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset = false, workspaceCwd = resolveWorkspaceCwd(), codexBinary = normalizeCodexBinary()) {
  if (existing.version !== packageVersion) {
    throw new Error(`Codex bridge v${existing.version} is already running at ${bridgeUrl(port)}${existing.pid ? ` (PID ${existing.pid})` : ""}; this CLI is v${packageVersion}. Run ${stopCommand(port)} before upgrading.`);
  }
  const missingOrigins = allowedOrigins.filter((origin) => !existing.allowedOrigins.includes(origin));
  if (missingOrigins.length) {
    throw new Error(`The existing Codex bridge does not allow: ${missingOrigins.join(", ")}. Run ${stopCommand(port)}, then restart with the requested --allow-origin values.`);
  }
  const extraOrigins = existing.allowedOrigins.filter((origin) => !allowedOrigins.includes(origin));
  if (extraOrigins.length && !reuseOriginSuperset) {
    throw new Error(`The existing Codex bridge additionally allows: ${extraOrigins.join(", ")}. Refusing to broaden this tool's origin policy silently. Run ${stopCommand(port)} and restart with the exact requested origins, or pass --reuse-origin-superset only if the broader allowlist is intentional.`);
  }
  if (existing.workspaceFingerprint !== workspaceFingerprint(workspaceCwd)) {
    throw new Error(`The existing Codex bridge uses a different default workspace. Run ${stopCommand(port)}, then restart it from this project or pass --cwd ${JSON.stringify(workspaceCwd)}.`);
  }
  if (existing.codexBinaryFingerprint !== codexBinaryFingerprint(codexBinary)) {
    throw new Error(`The existing Codex bridge uses a different Codex binary. Run ${stopCommand(port)}, then restart it with the intended --codex path.`);
  }
}

async function readBridgeStatus(port) {
  try {
    const response = await fetch(`${bridgeUrl(port)}/api/status`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return null;
    const value = await response.json();
    if (
      !value || value.service !== SERVICE_NAME || typeof value.version !== "string"
      || !["starting", "ready"].includes(value.status) || !Array.isArray(value.allowedOrigins)
      || !value.allowedOrigins.every((origin) => typeof origin === "string")
    ) return null;
    return {
      version: value.version,
      status: value.status,
      pid: Number.isSafeInteger(value.pid) && value.pid > 0 ? value.pid : null,
      allowedOrigins: value.allowedOrigins,
      protocol: value.protocol && Number.isSafeInteger(value.protocol.major) && Number.isSafeInteger(value.protocol.minor)
        ? { major: value.protocol.major, minor: value.protocol.minor }
        : null,
      capabilities: Array.isArray(value.capabilities) && value.capabilities.every((entry) => typeof entry === "string")
        ? value.capabilities
        : [],
      browserModules: Array.isArray(value.browserModules) && value.browserModules.every((entry) => typeof entry === "string")
        ? value.browserModules
        : [],
      workspaceFingerprint: typeof value.workspaceFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.workspaceFingerprint)
        ? value.workspaceFingerprint
        : null,
      codexBinaryFingerprint: typeof value.codexBinaryFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.codexBinaryFingerprint)
        ? value.codexBinaryFingerprint
        : null,
    };
  } catch {
    return null;
  }
}

async function waitForBridgeStop(port, pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = await readBridgeStatus(port);
    if (!status || status.pid !== pid) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function waitForBridgeReady(port, child, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) {
  const deadline = Date.now() + 10_000;
  let spawnError = null;
  child.once("error", (error) => { spawnError = error; });
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const status = await readBridgeStatus(port);
    if (status) {
      assertCompatibleBridge(status, port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
      if (status.status === "ready") return status;
    }
    if (child.exitCode !== null) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const status = await readBridgeStatus(port);
  if (status?.pid === child.pid) {
    try { process.kill(child.pid, "SIGTERM"); } catch (cause) { if (cause?.code !== "ESRCH") throw cause; }
  }
  return null;
}

async function readLogTail(logPath) {
  try {
    const value = await readFile(logPath, "utf8");
    return value.trim().slice(-4_000);
  } catch {
    return "";
  }
}

async function ensureBackgroundBridge(port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) {
  const existing = await readBridgeStatus(port);
  if (existing) {
    assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
    return { status: existing, reused: true, logPath: null };
  }

  const logDirectory = mkdtempSync(join(tmpdir(), "t3-code-ultralight-"));
  const logPath = join(logDirectory, `bridge-${port}.log`);
  const log = openSync(logPath, "wx", 0o600);
  let child;
  try {
    child = spawn(process.execPath, [
      fileURLToPath(import.meta.url),
      "serve",
      "--port",
      String(port),
      "--cwd",
      workspaceCwd,
      "--codex",
      codexBinary,
      ...allowedOrigins.flatMap((origin) => ["--allow-origin", origin]),
      ...(reuseOriginSuperset ? ["--reuse-origin-superset"] : []),
    ], {
      detached: true,
      env: process.env,
      stdio: ["ignore", log, log],
    });
  } finally {
    closeSync(log);
  }
  child.unref();
  const status = await waitForBridgeReady(port, child, allowedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
  if (!status) {
    const detail = await readLogTail(logPath);
    throw new Error(`Codex bridge did not become ready at ${bridgeUrl(port)}.${detail ? `\n${detail}` : ` Check ${logPath}.`}`);
  }
  return { status, reused: status.pid !== child.pid, logPath: status.pid === child.pid ? logPath : null };
}

function printStartReport(status, port, reused, logPath, requestedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) {
  const report = createStartReport(status, port, reused, logPath, requestedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary);
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else if (reused) console.log(`Codex bridge v${status.version} is already ${status.status} at ${bridgeUrl(port)}${status.pid ? ` (PID ${status.pid})` : ""}.`);
  else console.log(`Started Codex bridge v${status.version} in the background at ${bridgeUrl(port)}${status.pid ? ` (PID ${status.pid})` : ""}.\nWorkspace: ${workspaceCwd}\nLogs: ${logPath}`);
}

function createStartReport(status, port, reused, logPath, requestedOrigins, reuseOriginSuperset, workspaceCwd, codexBinary) {
  const extraAllowedOrigins = status.allowedOrigins.filter((origin) => !requestedOrigins.includes(origin));
  return {
    started: !reused,
    reused,
    running: true,
    port,
    portSelection: selectedPortMode(),
    url: bridgeUrl(port),
    version: status.version,
    status: status.status,
    pid: status.pid,
    cwd: workspaceCwd,
    codexBinary,
    allowedOrigins: status.allowedOrigins,
    extraAllowedOrigins,
    originSupersetAccepted: reused && reuseOriginSuperset && extraAllowedOrigins.length > 0,
    logPath: reused ? null : logPath,
  };
}

function selectedPortMode() {
  const value = valueAfter("--port");
  if (value === "auto") return "auto";
  return value ? "explicit" : "default";
}

function resolveWorkspaceCwd(value = process.cwd()) {
  const absolute = resolve(value);
  try { return realpathSync(absolute); } catch { return absolute; }
}

function workspaceFingerprint(cwd) {
  return createHash("sha256").update(resolveWorkspaceCwd(cwd)).digest("hex");
}

function normalizeCodexBinary(value = "codex") {
  const binary = value.trim();
  if (!binary) throw new Error("--codex requires a non-empty value.");
  if (binary.includes("/") || binary.includes("\\")) {
    const absolute = resolve(binary);
    try { return realpathSync(absolute); } catch { return absolute; }
  }
  const extensions = process.platform === "win32" && !extname(binary)
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = resolve(directory, `${binary}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch { /* Try the next PATH entry. */ }
    }
  }
  return binary;
}

function codexBinaryFingerprint(binary) {
  return createHash("sha256").update(normalizeCodexBinary(binary)).digest("hex");
}

function createLifecycleReport(specifier, port, allowedOrigins, reuseOriginSuperset, cwd, codexBinary) {
  const ensureArgs = [
    "start",
    "--port",
    String(port),
    "--codex",
    codexBinary,
    ...allowedOrigins.flatMap((origin) => ["--allow-origin", origin]),
    ...(reuseOriginSuperset ? ["--reuse-origin-superset"] : []),
    "--json",
  ];
  const statusArgs = ["status", "--port", String(port), "--json"];
  const stopArgs = ["stop", "--port", String(port), "--json"];
  const command = (name, args) => ({ command: name, args, cwd });
  return {
    requiredBeforeBrowser: true,
    runFrom: cwd,
    resolvedPort: port,
    resolvedPortStable: true,
    hostStartupRecommendation: "Run ensure before starting the web host; it is idempotent and preserves the recipe's exact port.",
    ensure: {
      installed: command("t3-code-ultralight", ensureArgs),
      zeroInstall: command("npx", ["--yes", specifier, ...ensureArgs]),
    },
    status: {
      installed: command("t3-code-ultralight", statusArgs),
      zeroInstall: command("npx", ["--yes", specifier, ...statusArgs]),
    },
    stop: {
      installed: command("t3-code-ultralight", stopArgs),
      zeroInstall: command("npx", ["--yes", specifier, ...stopArgs]),
    },
  };
}

function printSetupReport(report) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!report.ok) {
    console.log("Codex setup could not start the bridge.");
    for (const [name, check] of Object.entries(report.doctor.checks)) {
      console.log(`${check.ok ? "✓" : "✗"} ${name}: ${check.detail}`);
    }
    for (const recommendation of report.doctor.recommendations) console.log(`\n→ ${recommendation}`);
    return;
  }
  console.log(`Codex is ready at ${report.bridge.url}.`);
  console.log(`Integration mode: ${report.mode} (${report.delivery})`);
  if (report.integration.installCommand) console.log(`\nInstall in the host:\n${report.integration.installCommand}`);
  else console.log("No package install is required for this delivery.");
  console.log(`\nEnsure the local bridge before starting the host:\n${formatCommand(report.lifecycle.ensure.zeroInstall)}`);
  console.log(`\nAdd this ${report.integration.codeLanguage} to the host:\n${report.integration.code}`);
  if (Object.keys(report.integration.csp).length) {
    console.log(`\nCSP source additions:\n${JSON.stringify(report.integration.csp, null, 2)}`);
  }
  console.log(`\nVerify:\n${report.integration.verify}`);
}

function formatCommand({ command, args }) {
  return [command, ...args].map((value) => /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`).join(" ");
}

function unique(values) {
  return [...new Set(values)];
}

function stopCommand(port) {
  return `\`npx t3-code-ultralight stop --port ${port}\``;
}

function bridgeUrl(port) {
  return `http://127.0.0.1:${port}`;
}
