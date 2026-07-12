import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

describe("CLI argument validation", () => {
  it("fails before startup when --allow-origin has no value", async () => {
    const result = await runCli(["serve", "--allow-origin"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--allow-origin requires a value");
  });

  it("points agents at the stable prebuilt release", async () => {
    const result = await runCli(["agent-prompt"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("stable prebuilt release asset");
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

      const incompatible = await runCli(["serve", "--port", port, "--allow-origin", "https://voice.example.com"]);
      expect(incompatible.code).not.toBe(0);
      expect(incompatible.stderr).toContain("does not allow: https://voice.example.com");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects invalid ports before probing or starting", async () => {
    const result = await runCli(["status", "--port", "0"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("integer from 1 to 65535");
  });
});

function runCli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: error && "code" in error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}
