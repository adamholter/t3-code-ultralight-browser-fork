import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
});

function runCli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: error && "code" in error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}
