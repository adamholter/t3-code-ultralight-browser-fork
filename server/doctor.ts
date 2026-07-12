import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodexBridge } from "./codex-bridge.js";
import { resolveCodexCommand } from "./codex-command.js";
import { PACKAGE_VERSION } from "./version.js";

const execFileAsync = promisify(execFile);

export interface DoctorOptions {
  binary?: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface DoctorCheck {
  ok: boolean;
  detail: string;
  durationMs?: number;
}

export interface DoctorReport {
  ok: boolean;
  packageVersion: string;
  nodeVersion: string;
  checks: {
    codexBinary: DoctorCheck;
    appServer: DoctorCheck;
    account: DoctorCheck;
    models: DoctorCheck;
    threads: DoctorCheck;
  };
  recommendations: string[];
}

/** Run a read-only end-to-end readiness check without creating a thread. */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const binary = options.binary ?? "codex";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const checks = {
    codexBinary: pendingCheck(),
    appServer: pendingCheck(),
    account: pendingCheck(),
    models: pendingCheck(),
    threads: pendingCheck(),
  };
  const recommendations: string[] = [];
  let bridge: CodexBridge | null = null;

  try {
    const startedAt = performance.now();
    const invocation = resolveCodexCommand(binary, ["--version"], { cwd: options.cwd });
    const { stdout } = await execFileAsync(invocation.command, invocation.args, {
      cwd: options.cwd,
      timeout: timeoutMs,
      windowsHide: true,
    });
    checks.codexBinary = pass(stdout.trim(), startedAt);
  } catch (error) {
    checks.codexBinary = fail(formatError(error));
    recommendations.push("Install the Codex CLI and make sure `codex --version` works in this shell.");
    return report(false, checks, recommendations);
  }

  try {
    bridge = new CodexBridge({
      binary,
      cwd: options.cwd,
      requestTimeoutMs: timeoutMs,
      clientInfo: { name: "t3_code_ultralight_doctor", title: "T3 Code Ultralight Doctor", version: PACKAGE_VERSION },
    });
    const startedAt = performance.now();
    await bridge.start();
    checks.appServer = pass("initialize handshake completed", startedAt);
  } catch (error) {
    checks.appServer = fail(formatError(error));
    recommendations.push("Run `codex app-server --help` and resolve any CLI configuration error shown there.");
    await bridge?.stop();
    return report(false, checks, recommendations);
  }

  try {
    const startedAt = performance.now();
    const response = await bridge.request("account/read", { refreshToken: false }) as {
      account: { type?: string } | null;
      requiresOpenaiAuth?: boolean;
    };
    const authenticated = response.account !== null || response.requiresOpenaiAuth === false;
    checks.account = authenticated
      ? pass(`authenticated (${response.account?.type ?? "external"})`, startedAt)
      : fail("Codex requires OpenAI authentication", startedAt);
    if (!authenticated) recommendations.push("Run `codex login`, then rerun this doctor command.");
  } catch (error) {
    checks.account = fail(formatError(error));
    recommendations.push("Check the active Codex login with `codex login status`.");
  }

  try {
    const startedAt = performance.now();
    const response = await bridge.request("model/list", { limit: 100 }) as {
      data?: Array<{ model?: string; displayName?: string; isDefault?: boolean }>;
    };
    const models = response.data ?? [];
    const defaultModel = models.find((model) => model.isDefault)?.displayName
      ?? models.find((model) => model.isDefault)?.model
      ?? models[0]?.displayName
      ?? models[0]?.model;
    checks.models = models.length
      ? pass(`${models.length} available; default ${defaultModel ?? "reported by Codex"}`, startedAt)
      : fail("Codex returned no models", startedAt);
    if (!models.length) recommendations.push("Confirm the active Codex account has access to at least one model.");
  } catch (error) {
    checks.models = fail(formatError(error));
  }

  try {
    const startedAt = performance.now();
    await bridge.request("thread/list", {
      limit: 1,
      sortKey: "recency_at",
      sortDirection: "desc",
      useStateDbOnly: true,
    });
    checks.threads = pass("local thread store is readable", startedAt);
  } catch (error) {
    checks.threads = fail(formatError(error));
    recommendations.push("Check that CODEX_HOME is readable and points to the intended local Codex profile.");
  } finally {
    await bridge.stop();
  }

  return report(Object.values(checks).every((check) => check.ok), checks, recommendations);
}

function pendingCheck(): DoctorCheck {
  return { ok: false, detail: "not run" };
}

function pass(detail: string, startedAt: number): DoctorCheck {
  return { ok: true, detail, durationMs: Math.round(performance.now() - startedAt) };
}

function fail(detail: string, startedAt?: number): DoctorCheck {
  return {
    ok: false,
    detail,
    ...(startedAt === undefined ? {} : { durationMs: Math.round(performance.now() - startedAt) }),
  };
}

function report(
  ok: boolean,
  checks: DoctorReport["checks"],
  recommendations: string[],
): DoctorReport {
  return {
    ok,
    packageVersion: PACKAGE_VERSION,
    nodeVersion: process.version,
    checks,
    recommendations,
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
