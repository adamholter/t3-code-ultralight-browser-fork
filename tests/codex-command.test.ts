import { describe, expect, it } from "vitest";
import { resolveCodexCommand } from "../server/codex-command";

describe("Codex command resolution", () => {
  it("routes Windows batch shims through cmd.exe with quoted fixed arguments", () => {
    expect(resolveCodexCommand("codex.cmd", ["app-server", "--stdio"], {
      platform: "win32",
      env: { PATH: "", ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    })).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/v:off", "/c", '""codex.cmd" "app-server" "--stdio""'],
      windowsVerbatimArguments: true,
    });
  });

  it("keeps native Windows executables shell-free", () => {
    expect(resolveCodexCommand("codex.exe", ["--version"], {
      platform: "win32",
      env: { PATH: "" },
    })).toEqual({ command: "codex.exe", args: ["--version"] });
  });

  it("rejects percent expansion in batch-shim arguments", () => {
    expect(() => resolveCodexCommand("codex.cmd", ["%PATH%"], {
      platform: "win32",
      env: { PATH: "" },
    })).toThrow("Windows batch Codex argument cannot contain %");
  });
});
