type Handler = (payload: any) => void;

export class CodexClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private handlers = new Map<string, Set<Handler>>();
  private nextId = 1;
  private reconnectTimer: number | null = null;

  connect() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket.addEventListener("open", () => this.emit("connection", "ready"));
    this.socket.addEventListener("message", (event) => this.onMessage(JSON.parse(event.data)));
    this.socket.addEventListener("close", () => {
      this.emit("connection", "offline");
      this.reconnectTimer = window.setTimeout(() => this.connect(), 900);
    });
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    const id = `web-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: "rpc", id, method, params });
    });
  }

  respond(id: string | number, result: unknown) {
    this.send({ type: "respond", id, result });
  }

  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  private send(payload: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Codex bridge is not connected");
    this.socket.send(JSON.stringify(payload));
  }

  private onMessage(message: any) {
    if (message.type === "rpcResult" || message.type === "rpcError") {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      message.type === "rpcError" ? request.reject(new Error(message.error)) : request.resolve(message.result);
      return;
    }
    this.emit(message.type, message);
    if (message.type === "notification") this.emit(message.method, message.params);
  }

  private emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

export const codex = new CodexClient();
