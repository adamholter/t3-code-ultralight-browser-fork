import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

describe("CLI argument validation", () => {
  it("fails closed on unknown commands, typoed flags, duplicates, and stray values", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage:");

    const unknown = await runCli(["strat"]);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('Unknown command "strat"');

    const duplicate = await runCli(["status", "--port", "4174", "--port", "4175"]);
    expect(duplicate.code).not.toBe(0);
    expect(duplicate.stderr).toContain("--port may be provided only once");

    const stray = await runCli(["integration", "extra"]);
    expect(stray.code).not.toBe(0);
    expect(stray.stderr).toContain('Unexpected argument "extra"');

    const port = String(await reservePort());
    const typo = await runCli(["start", "--port", port, "--allow-orign", "https://canvas.example.com"]);
    expect(typo.code).not.toBe(0);
    expect(typo.stderr).toContain('Unknown option "--allow-orign"');
    const status = await runCli(["status", "--port", port, "--json"]);
    expect(status.code).not.toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: false });
  });

  it("fails before startup when --allow-origin has no value", async () => {
    const result = await runCli(["serve", "--allow-origin"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--allow-origin requires a value");
  });

  it("validates setup mode before running diagnostics", async () => {
    const result = await runCli(["setup", "--mode", "dashboard", "--json"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Invalid --mode "dashboard"');
  });

  it("returns a machine-readable failed setup receipt without starting a bridge", async () => {
    const port = String(await reservePort());
    const result = await runCli(["setup", "--mode", "custom", "--port", port, "--codex", "/missing/codex", "--json"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      mode: "custom",
      doctor: { ok: false },
      bridge: null,
      integration: null,
    });
    const status = await runCli(["status", "--port", port, "--json"]);
    expect(status.code).not.toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: false });
  });

  it("points agents at the stable prebuilt release", async () => {
    const result = await runCli(["agent-prompt"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("stable prebuilt release asset");
    expect(result.stdout).toContain("package setup command");
  });

  it("prints the packaged machine-readable integration contract", async () => {
    const result = await runCli(["integration"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      name: packageJson.name,
      version: packageJson.version,
      bridge: { integrationPath: "/api/integration" },
    });
  });

  it("reports and reuses a compatible running bridge", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        service: "t3-code-ultralight-browser-fork",
        version: packageJson.version,
        status: "ready",
        pid: process.pid,
        allowedOrigins: ["https://canvas.example.com"],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = String((server.address() as AddressInfo).port);
    try {
      const status = await runCli(["status", "--port", port, "--json"]);
      expect(status.code).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({ running: true, version: packageJson.version, status: "ready" });

      const reused = await runCli(["serve", "--port", port, "--allow-origin", "https://canvas.example.com/"]);
      expect(reused.code).toBe(0);
      expect(reused.stdout).toContain("is already ready");

      const backgroundReuse = await runCli(["start", "--port", port, "--allow-origin", "https://canvas.example.com", "--json"]);
      expect(backgroundReuse.code).toBe(0);
      expect(JSON.parse(backgroundReuse.stdout)).toMatchObject({
        started: false,
        reused: true,
        running: true,
        version: packageJson.version,
        pid: process.pid,
        logPath: null,
        extraAllowedOrigins: [],
        originSupersetAccepted: false,
      });

      const narrower = await runCli(["start", "--port", port, "--json"]);
      expect(narrower.code).not.toBe(0);
      expect(narrower.stderr).toContain("additionally allows: https://canvas.example.com");
      expect(narrower.stderr).toContain("--reuse-origin-superset");

      const intentionalSuperset = await runCli(["start", "--port", port, "--reuse-origin-superset", "--json"]);
      expect(intentionalSuperset.code).toBe(0);
      expect(JSON.parse(intentionalSuperset.stdout)).toMatchObject({
        reused: true,
        allowedOrigins: ["https://canvas.example.com"],
        extraAllowedOrigins: ["https://canvas.example.com"],
        originSupersetAccepted: true,
      });

      const incompatible = await runCli(["serve", "--port", port, "--allow-origin", "https://voice.example.com"]);
      expect(incompatible.code).not.toBe(0);
      expect(incompatible.stderr).toContain("does not allow: https://voice.example.com");
      expect(incompatible.stderr).toContain(`stop --port ${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects invalid ports before probing or starting", async () => {
    const result = await runCli(["status", "--port", "0"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("integer from 1 to 65535");
  });

  it("stops only a verified bridge process and stays idempotent", async () => {
    const port = await reservePort();
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      `
        import { createServer } from "node:http";
        const port = Number(process.argv[1]);
        const server = createServer((_request, response) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({
            service: "t3-code-ultralight-browser-fork",
            version: ${JSON.stringify(packageJson.version)},
            status: "ready",
            pid: process.pid,
            allowedOrigins: [],
          }));
        });
        server.listen(port, "127.0.0.1", () => console.log("ready"));
        process.on("SIGTERM", () => server.close(() => process.exit(0)));
      `,
      String(port),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await waitForOutput(child.stdout!, "ready");
      const stopped = await runCli(["stop", "--port", String(port), "--json"]);
      expect(stopped.code).toBe(0);
      expect(JSON.parse(stopped.stdout)).toMatchObject({ stopped: true, running: false, pid: child.pid, version: packageJson.version });
      await waitForExit(child);

      const repeated = await runCli(["stop", "--port", String(port), "--json"]);
      expect(repeated.code).toBe(0);
      expect(JSON.parse(repeated.stdout)).toMatchObject({ stopped: false, running: false, pid: null });
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  });

  it("does not signal an unrelated process listening on the requested port", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ service: "another-app", pid: process.pid }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = String((server.address() as AddressInfo).port);
    try {
      const start = await runCli(["start", "--port", port, "--json"]);
      expect(start.code).not.toBe(0);
      expect(start.stderr).toContain(`Port ${port} is already in use by a different service`);

      const result = await runCli(["stop", "--port", port, "--json"]);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ stopped: false, running: false });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function waitForOutput(stream: NodeJS.ReadableStream, expected: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 2_000);
    stream.on("data", (chunk) => {
      if (!String(chunk).includes(expected)) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForExit(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

function runCli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: error && "code" in error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}
