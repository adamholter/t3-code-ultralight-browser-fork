import { describe, expect, it } from "vitest";
import { createCodexAssistant } from "../src/lib/codex-assistant";
import type { CodexClient } from "../src/lib/codex-client";

describe("CodexAssistant", () => {
  it("owns one scoped fail-closed request adapter and detaches it on close", async () => {
    const client = new FakeClient();
    const assistant = createCodexAssistant({ client: client as unknown as CodexClient });
    assistant.threadId = "thread-canvas";

    expect(client.listenerCount).toBe(3);
    client.emit("serverRequest", {
      id: "approval",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-canvas" },
    });
    client.emit("serverRequest", {
      id: "other",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-voice" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.responses).toEqual([{ id: "approval", result: { decision: "decline" } }]);
    await assistant.close();
    expect(client.listenerCount).toBe(0);
    expect(client.closeCount).toBe(0);
    await assistant.close();
    expect(client.listenerCount).toBe(0);
  });
});

class FakeClient {
  responses: Array<{ id: string | number; result: unknown }> = [];
  closeCount = 0;
  private handlers = new Map<string, Set<(payload: any) => void>>();

  get listenerCount() {
    return [...this.handlers.values()].reduce((total, handlers) => total + handlers.size, 0);
  }

  on(event: string, handler: (payload: any) => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  respond(id: string | number, result: unknown) {
    this.responses.push({ id, result });
  }

  respondError() {}
  close() { this.closeCount += 1; }
}
