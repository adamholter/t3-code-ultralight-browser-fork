import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "bin/cli.mjs");
const started = runCapture([cli, "start", "--cwd", root, "--json"]);
const receipt = JSON.parse(started.stdout);

const suites = [
  ["standalone performance", [resolve(root, "tests/performance-qa.mjs")]],
  ["deterministic multi-project auto ports", [resolve(root, "tests/auto-port-qa.mjs")]],
  ["custom Codex binary propagation", [resolve(root, "tests/custom-binary-qa.mjs")]],
  ["durable lifecycle receipt", [resolve(root, "tests/lifecycle-receipt-qa.mjs")]],
  ["zero-install modules", [resolve(root, "tests/no-bundler-qa.mjs")]],
  ["generated hosted assistant recipe", [resolve(root, "tests/hosted-recipe-qa.mjs")]],
  ["packed React 18 and 19 hosts", [resolve(root, "tests/react-host-qa.mjs")]],
  ["packed Next.js 16 App Router host", [resolve(root, "tests/next-host-qa.mjs")]],
  ["packed Vue 3 and Svelte 5 hosts", [resolve(root, "tests/framework-host-qa.mjs")]],
  ["packed existing Node server", [resolve(root, "tests/attached-server-qa.mjs")]],
  ["complete browser story", [resolve(root, "tests/qa.mjs")]],
  ["external HTTPS origin", [resolve(root, "tests/external-origin-qa.mjs")]],
  ["trusted file origin", [resolve(root, "tests/file-origin-qa.mjs")]],
  ["fresh project workspace", [resolve(root, "tests/workspace-qa.mjs")]],
  ["Markdown rendering", ["--import", "tsx", resolve(root, "tests/markdown-qa.tsx")]],
  ["permission rendering", ["--import", "tsx", resolve(root, "tests/permission-qa.tsx")]],
  ["MCP rendering", ["--import", "tsx", resolve(root, "tests/mcp-qa.tsx")]],
];

try {
  for (const [name, args] of suites) {
    process.stdout.write(`\n[qa] ${name}\n`);
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${name} QA failed with exit code ${result.status ?? "unknown"}`);
  }
  console.log(JSON.stringify({
    ok: true,
    bridge: receipt.url,
    bridgeStartedForQa: receipt.started,
    workspace: receipt.cwd,
    suites: suites.map(([name]) => name),
  }, null, 2));
} finally {
  if (receipt.started) {
    const stopped = spawnSync(process.execPath, [cli, "stop", "--json"], { cwd: root, encoding: "utf8" });
    if (stopped.status !== 0) process.stderr.write(stopped.stderr || stopped.stdout);
  }
}

function runCapture(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Unable to start the QA bridge");
  return result;
}
