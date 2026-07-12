import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, extname, resolve } from "node:path";

export interface CodexCommandInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface ResolveCodexCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Resolve a Codex executable and safely route Windows batch shims through cmd.exe. */
export function resolveCodexCommand(
  binary: string,
  args: readonly string[],
  options: ResolveCodexCommandOptions = {},
): CodexCommandInvocation {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const executable = resolveCodexExecutable(binary, {
    cwd: options.cwd,
    env,
    platform,
  });

  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { command: executable, args: [...args] };
  }

  const commandInterpreter = env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
  const commandLine = [
    quoteWindowsBatchArgument(executable, "path"),
    ...args.map((arg) => quoteWindowsBatchArgument(arg, "argument")),
  ].join(" ");
  return {
    command: commandInterpreter,
    // With /s, cmd.exe requires one outer pair of quotes around a command
    // whose executable path is itself quoted. Passing the quoted path and
    // arguments as separate argv entries causes cmd to consume the path's
    // opening quote and leave an invalid trailing quote instead.
    args: ["/d", "/s", "/v:off", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

export function resolveCodexExecutable(
  binary: string,
  options: ResolveCodexCommandOptions = {},
) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  if (binary.includes("/") || binary.includes("\\")) {
    return realpathOr(resolve(cwd, binary));
  }

  const extensions = platform === "win32" && !extname(binary)
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = resolve(directory, `${binary}${extension}`);
      try {
        accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        return realpathOr(candidate);
      } catch { /* Try the next PATH entry. */ }
    }
  }
  return binary;
}

function realpathOr(path: string) {
  try { return realpathSync(path); } catch { return path; }
}

function quoteWindowsBatchArgument(value: string, label: "path" | "argument") {
  // cmd.exe expands percent variables even inside quotes. Codex's own launch
  // arguments never need them, so reject instead of creating an injection edge.
  if (value.includes("%")) {
    throw new Error(`Windows batch Codex ${label} cannot contain %`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}
