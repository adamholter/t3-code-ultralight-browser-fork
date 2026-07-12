#!/usr/bin/env node

import { closeSync, mkdtempSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_NAME = "t3-code-ultralight-browser-fork";
const DEFAULT_PORT = 4174;
const { version: packageVersion } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2] ?? "serve";

  if (command === "serve") {
    const port = parsePort(valueAfter("--port"));
    const allowedOrigins = unique(valuesAfter("--allow-origin").map(normalizeOrigin));
    const reuseOriginSuperset = process.argv.includes("--reuse-origin-superset");
    const existing = await readBridgeStatus(port);
    if (existing) {
      assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset);
      console.log(`Codex bridge v${existing.version} is already ${existing.status} at ${bridgeUrl(port)}${existing.pid ? ` (PID ${existing.pid})` : ""}.`);
      return;
    }
    process.env.PORT = String(port);
    if (allowedOrigins.length) process.env.CODEX_ALLOWED_ORIGINS = JSON.stringify(allowedOrigins);
    process.env.NODE_ENV = "production";
    await import("../dist-lib/standalone.js");
    return;
  }

  if (command === "start") {
    const port = parsePort(valueAfter("--port"));
    const allowedOrigins = unique(valuesAfter("--allow-origin").map(normalizeOrigin));
    const reuseOriginSuperset = process.argv.includes("--reuse-origin-superset");
    const existing = await readBridgeStatus(port);
    if (existing) {
      assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset);
      printStartReport(existing, port, true, null, allowedOrigins, reuseOriginSuperset);
      return;
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
    const status = await waitForBridgeReady(port, child, allowedOrigins, reuseOriginSuperset);
    if (!status) {
      const detail = await readLogTail(logPath);
      throw new Error(`Codex bridge did not become ready at ${bridgeUrl(port)}.${detail ? `\n${detail}` : ` Check ${logPath}.`}`);
    }
    printStartReport(status, port, status.pid !== child.pid, logPath, allowedOrigins, reuseOriginSuperset);
    return;
  }

  if (command === "status") {
    const port = parsePort(valueAfter("--port"));
    const status = await readBridgeStatus(port);
    const report = status
      ? { running: true, url: bridgeUrl(port), ...status }
      : { running: false, url: bridgeUrl(port), version: null, status: "offline", pid: null, allowedOrigins: [], protocol: null, capabilities: [], browserModules: [] };
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
      cwd: valueAfter("--cwd"),
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
Run the package doctor first, then use the background start command with JSON output. Use the isolated chat embed unless the existing UI needs custom rendering.
Keep the bridge loopback-only. If a custom browser UI is not on loopback, allow only its exact origin.
Use the idempotent stop command before replacing a bridge for an upgrade or origin change.
Preserve approvals and verify one live turn through the final UI.`);
    return;
  }

  console.log(`
t3-code-ultralight

Usage:
  t3-code-ultralight start [--port 4174] [--allow-origin ORIGIN]... [--reuse-origin-superset] [--json]
  t3-code-ultralight serve [--port 4174] [--allow-origin ORIGIN]... [--reuse-origin-superset]
  t3-code-ultralight status [--port 4174] [--json]
  t3-code-ultralight stop [--port 4174] [--json]
  t3-code-ultralight doctor [--json] [--codex PATH] [--cwd PATH]
  t3-code-ultralight integration
  t3-code-ultralight agent-prompt

Commands:
  start         Start in the background, wait for ready, or reuse a compatible bridge.
  serve         Run the loopback bridge in the foreground.
  status        Inspect a running standalone bridge without starting Codex.
  stop          Stop a verified standalone bridge; safe to run repeatedly.
  doctor        Verify the CLI, app-server, login, models, and thread store.
  integration   Print the machine-readable integration contract.
  agent-prompt  Print a ready-to-paste integration prompt.
`);
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

function parsePort(value) {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid --port ${JSON.stringify(value)}. Use an integer from 1 to 65535.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid --port ${JSON.stringify(value)}. Use an integer from 1 to 65535.`);
  }
  return port;
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

function assertCompatibleBridge(existing, port, allowedOrigins, reuseOriginSuperset = false) {
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

async function waitForBridgeReady(port, child, allowedOrigins, reuseOriginSuperset) {
  const deadline = Date.now() + 10_000;
  let spawnError = null;
  child.once("error", (error) => { spawnError = error; });
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const status = await readBridgeStatus(port);
    if (status) {
      assertCompatibleBridge(status, port, allowedOrigins, reuseOriginSuperset);
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

function printStartReport(status, port, reused, logPath, requestedOrigins, reuseOriginSuperset) {
  const extraAllowedOrigins = status.allowedOrigins.filter((origin) => !requestedOrigins.includes(origin));
  const report = {
    started: !reused,
    reused,
    running: true,
    url: bridgeUrl(port),
    version: status.version,
    status: status.status,
    pid: status.pid,
    allowedOrigins: status.allowedOrigins,
    extraAllowedOrigins,
    originSupersetAccepted: reused && reuseOriginSuperset && extraAllowedOrigins.length > 0,
    logPath: reused ? null : logPath,
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else if (reused) console.log(`Codex bridge v${status.version} is already ${status.status} at ${bridgeUrl(port)}${status.pid ? ` (PID ${status.pid})` : ""}.`);
  else console.log(`Started Codex bridge v${status.version} in the background at ${bridgeUrl(port)}${status.pid ? ` (PID ${status.pid})` : ""}.\nLogs: ${logPath}`);
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
