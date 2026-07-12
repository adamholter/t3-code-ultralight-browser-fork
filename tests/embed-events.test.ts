import { describe, expect, it } from "vitest";
import { isCodexEmbedEvent, postCodexEmbedEvent } from "../src/embed-events";

const base = { source: "t3-code-ultralight", version: 1 };

describe("embed lifecycle protocol", () => {
  it.each([
    { ...base, event: "ready", status: "ready", modelCount: 7 },
    { ...base, event: "connection", status: "offline" },
    { ...base, event: "thread", threadId: null },
    { ...base, event: "turn", phase: "started", threadId: "thread-1", turnId: "turn-1" },
    { ...base, event: "error", message: "Bridge unavailable" },
  ])("accepts a valid $event message", (message) => {
    expect(isCodexEmbedEvent(message)).toBe(true);
  });

  it.each([
    null,
    { ...base, event: "ready", status: "ready" },
    { ...base, event: "connection", status: "compromised" },
    { ...base, event: "turn", phase: "started", threadId: "thread-1" },
    { ...base, version: 2, event: "thread", threadId: null },
    { source: "lookalike", version: 1, event: "error", message: "no" },
  ])("rejects a malformed or foreign message", (message) => {
    expect(isCodexEmbedEvent(message)).toBe(false);
  });

  it("is safe to call outside a browser", () => {
    expect(postCodexEmbedEvent({ event: "connection", status: "starting" })).toBe(false);
  });
});
