import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

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

export class CodexBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<RpcId, PendingRequest>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  private stopped = false;

  get ready() {
    return this.child !== null;
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.boot();
    return this.readyPromise;
  }

  private async boot() {
    this.stopped = false;
    this.child = spawn("codex", ["app-server", "--stdio"], {
      cwd: process.env.HOME,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
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

    this.child.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.child = null;
      this.readyPromise = null;
      this.emit("exit", { code, signal });
      if (!this.stopped) setTimeout(() => void this.start(), 750);
    });

    await this.request("initialize", {
      clientInfo: { name: "codex_web", title: "Codex Web", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
      },
    });
    this.notify("initialized");
    this.emit("ready");
  }

  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
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

  stop() {
    this.stopped = true;
    this.child?.kill("SIGTERM");
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
