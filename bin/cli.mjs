#!/usr/bin/env node

const command = process.argv[2] ?? "serve";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

if (command === "serve") {
  const port = valueAfter("--port");
  if (port) process.env.PORT = port;
  const allowedOrigins = valuesAfter("--allow-origin");
  if (allowedOrigins.length) process.env.CODEX_ALLOWED_ORIGINS = JSON.stringify(allowedOrigins);
  process.env.NODE_ENV = "production";
  await import("../dist-lib/standalone.js");
} else if (command === "doctor") {
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
} else if (command === "agent-prompt") {
  console.log(`Install https://github.com/adamholter/t3-code-ultralight-browser-fork.
Allow this web app to talk to the user's local Codex.
Run the package doctor first. Use the isolated chat embed unless the existing UI needs custom rendering.
Keep the bridge loopback-only. If a custom browser UI is not on loopback, allow only its exact origin.
Preserve approvals and verify one live turn through the final UI.`);
} else {
  console.log(`
t3-code-ultralight

Usage:
  t3-code-ultralight serve [--port 4174] [--allow-origin ORIGIN]...
  t3-code-ultralight doctor [--json] [--codex PATH] [--cwd PATH]
  t3-code-ultralight agent-prompt

Commands:
  serve         Start the loopback bridge and chat UI. Extra browser origins must be explicit.
  doctor        Verify the CLI, app-server, login, models, and thread store.
  agent-prompt  Print a ready-to-paste integration prompt.
`);
}
