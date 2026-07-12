#!/usr/bin/env node

import { readFile } from "node:fs/promises";

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
    const allowedOrigins = valuesAfter("--allow-origin").map(normalizeOrigin);
    const existing = await readBridgeStatus(port);
    if (existing) {
      if (existing.version !== packageVersion) {
        throw new Error(`Codex bridge v${existing.version} is already running at ${bridgeUrl(port)}${existing.pid ? ` (PID ${existing.pid})` : ""}; this CLI is v${packageVersion}. Stop the existing bridge before upgrading.`);
      }
      const missingOrigins = allowedOrigins.filter((origin) => !existing.allowedOrigins.includes(origin));
      if (missingOrigins.length) {
        throw new Error(`The existing Codex bridge does not allow: ${missingOrigins.join(", ")}. Stop it and restart with the requested --allow-origin values.`);
      }
      console.log(`Codex bridge v${existing.version} is already ${existing.status} at ${bridgeUrl(port)}${existing.pid ? ` (PID ${existing.pid})` : ""}.`);
      return;
    }
    process.env.PORT = String(port);
    if (allowedOrigins.length) process.env.CODEX_ALLOWED_ORIGINS = JSON.stringify(allowedOrigins);
    process.env.NODE_ENV = "production";
    await import("../dist-lib/standalone.js");
    return;
  }

  if (command === "status") {
    const port = parsePort(valueAfter("--port"));
    const status = await readBridgeStatus(port);
    const report = status
      ? { running: true, url: bridgeUrl(port), ...status }
      : { running: false, url: bridgeUrl(port), version: null, status: "offline", pid: null, allowedOrigins: [] };
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else if (status) {
      console.log(`Codex bridge v${status.version} is ${status.status} at ${bridgeUrl(port)}${status.pid ? ` (PID ${status.pid})` : ""}.`);
      console.log(`Allowed browser origins: ${status.allowedOrigins.length ? status.allowedOrigins.join(", ") : "loopback only"}`);
    } else {
      console.log(`No Codex bridge is running at ${bridgeUrl(port)}.`);
    }
    if (!status) process.exitCode = 1;
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

  if (command === "agent-prompt") {
    console.log(`Install https://github.com/adamholter/t3-code-ultralight-browser-fork.
Allow this web app to talk to the user's local Codex.
Use the stable prebuilt release asset linked in the README so installation does not compile the package.
Run the package doctor first. Use the isolated chat embed unless the existing UI needs custom rendering.
Keep the bridge loopback-only. If a custom browser UI is not on loopback, allow only its exact origin.
Preserve approvals and verify one live turn through the final UI.`);
    return;
  }

  console.log(`
t3-code-ultralight

Usage:
  t3-code-ultralight serve [--port 4174] [--allow-origin ORIGIN]...
  t3-code-ultralight status [--port 4174] [--json]
  t3-code-ultralight doctor [--json] [--codex PATH] [--cwd PATH]
  t3-code-ultralight agent-prompt

Commands:
  serve         Start the loopback bridge, or reuse an identical running bridge.
  status        Inspect a running standalone bridge without starting Codex.
  doctor        Verify the CLI, app-server, login, models, and thread store.
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
    };
  } catch {
    return null;
  }
}

function bridgeUrl(port) {
  return `http://127.0.0.1:${port}`;
}
