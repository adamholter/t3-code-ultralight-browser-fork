import { describe, expect, it } from "vitest";
import { appendItemDelta, flattenItems, reconcileStreamedItem, upsertItem, userInputText } from "../src/lib/thread-items";

describe("thread item helpers", () => {
  it("flattens persisted turns", () => {
    expect(flattenItems([{ id: "t", status: "completed", error: null, items: [{ type: "agentMessage", id: "a", text: "hi" }] }])).toHaveLength(1);
  });

  it("upserts streamed items and deltas", () => {
    const started = upsertItem([], { type: "agentMessage", id: "a", text: "" });
    expect(appendItemDelta(started, "a", "text", "hello")[0]).toMatchObject({ text: "hello" });
    expect(upsertItem(started, { type: "agentMessage", id: "a", text: "done" })).toHaveLength(1);
  });

  it("extracts text input", () => {
    expect(userInputText([{ type: "text", text: "one" }, { type: "text", text: "two" }])).toBe("one\ntwo");
  });

  it("reconciles a server user message with its optimistic copy", () => {
    const local = [{ type: "userMessage", id: "local-1", content: [{ type: "text", text: "hello" }] }];
    const next = reconcileStreamedItem(local, { type: "userMessage", id: "server-1", content: [{ type: "text", text: "hello" }] });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("server-1");
  });
});
