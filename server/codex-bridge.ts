import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolveCodexCommand } from "./codex-command.js";
import { PACKAGE_VERSION } from "./version.js";

type RpcId = number | string;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface RpcServerRequest extends RpcNotification {
  id: RpcId;
}

export interface CodexBridgeOptions {
  binary?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  clientInfo?: { name: string; title: string; version: string };
}

export class CodexBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<RpcId, PendingRequest>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  private stopped = false;
  private initialized = false;

  constructor(private readonly options: CodexBridgeOptions = {}) {
    super();
  }

  get ready() {
    return this.initialized;
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.boot().catch(async (error) => {
      await this.stop();
      this.readyPromise = null;
      this.initialized = false;
      throw error;
    });
    return this.readyPromise;
  }

  private async boot() {
    this.stopped = false;
    this.initialized = false;
    const cwd = this.options.cwd ?? process.cwd();
    const env = this.options.env ?? process.env;
    const invocation = resolveCodexCommand(
      this.options.binary ?? "codex",
      this.options.args ?? ["app-server", "--stdio"],
      { cwd, env },
    );
    this.child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });

    createInterface({ input: this.child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.handleMessage(JSON.parse(line));
      } catch (error) {
        this.emit("log", { level: "error", message: `Invalid Codex response: ${String(error)}` });
      }
    });

    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.emit("log", { level: "debug", message: line });
    });

    const spawnedChild = this.child;
    const spawnFailure = new Promise<never>((_resolve, reject) => {
      spawnedChild.once("error", (error) => {
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        this.pending.clear();
        if (this.child === spawnedChild) this.child = null;
        reject(error);
      });
    });

    this.child.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.child = null;
      this.initialized = false;
      this.readyPromise = null;
      this.emit("exit", { code, signal });
      if (!this.stopped) setTimeout(() => void this.start(), 750);
    });

    await Promise.race([this.request("initialize", {
      clientInfo: this.options.clientInfo ?? { name: "t3_code_ultralight", title: "T3 Code Ultralight", version: PACKAGE_VERSION },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
      },
    }), spawnFailure]);
    this.notify("initialized");
    this.initialized = true;
    this.emit("ready");
  }

  request(method: string, params?: unknown, timeoutMs = this.options.requestTimeoutMs ?? 30_000): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown) {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: RpcId, result: unknown) {
    this.write({ id, result });
  }

  respondError(id: RpcId, message: string) {
    this.write({ id, error: { code: -32000, message } });
  }

  async stop() {
    this.stopped = true;
    this.initialized = false;
    const child = this.child;
    if (!child) return;
    const exited = once(child, "exit").then(() => undefined).catch(() => undefined);
    child.kill("SIGTERM");
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!graceful && child.exitCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }

  private write(payload: unknown) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is unavailable");
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleMessage(message: Record<string, unknown>) {
    if ("id" in message && ("result" in message || "error" in message)) {
      const request = this.pending.get(message.id as RpcId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id as RpcId);
      if (message.error) {
        const detail = message.error as { message?: string };
        request.reject(new Error(detail.message ?? JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") return;
    if ("id" in message) {
      this.emit("request", message as unknown as RpcServerRequest);
    } else {
      this.emit("notification", message as unknown as RpcNotification);
    }
  }
}
