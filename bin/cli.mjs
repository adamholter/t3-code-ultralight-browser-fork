#!/usr/bin/env node

const command = process.argv[2] ?? "serve";

if (command === "serve") {
  const portFlag = process.argv.indexOf("--port");
  if (portFlag >= 0 && process.argv[portFlag + 1]) process.env.PORT = process.argv[portFlag + 1];
  process.env.NODE_ENV = "production";
  await import("../dist-lib/standalone.js");
} else {
  console.log(`
t3-code-ultralight

Usage:
  t3-code-ultralight serve [--port 4174]

Starts the localhost-only Codex bridge and embeddable chat UI.
`);
}
