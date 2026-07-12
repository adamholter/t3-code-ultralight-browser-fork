import { describe, expect, it } from "vitest";
import {
  createCodexEmbedController,
  isAllowedCodexEmbedHostOrigin,
  isCodexEmbedCommand,
  isCodexEmbedEvent,
  postCodexEmbedEvent,
} from "../src/embed-events";

const base = { source: "t3-code-ultralight", version: 1 };

describe("embed lifecycle protocol", () => {
  it.each([
    { ...base, event: "ready", status: "ready", modelCount: 7 },
    { ...base, event: "connection", status: "offline" },
    { ...base, event: "thread", threadId: null },
    { ...base, event: "turn", phase: "started", threadId: "thread-1", turnId: "turn-1" },
    { ...base, event: "command", requestId: "request-1", command: "send", ok: true, threadId: "thread-1", turnId: "turn-1" },
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

  it.each([
    { ...base, direction: "host-command", requestId: "request-1", command: "ping" },
    { ...base, direction: "host-command", requestId: "request-2", command: "newThread" },
    { ...base, direction: "host-command", requestId: "request-3", command: "stop" },
    { ...base, direction: "host-command", requestId: "request-4", command: "send", text: "Explain this selection", newThread: true, cwd: "/workspace" },
  ])("accepts a valid $command host command", (command) => {
    expect(isCodexEmbedCommand(command)).toBe(true);
  });

  it.each([
    { ...base, direction: "host-command", requestId: "", command: "ping" },
    { ...base, direction: "host-command", requestId: "request-1", command: "send", text: "   " },
    { ...base, direction: "host-command", requestId: "request-1", command: "send", text: "ok", cwd: "" },
    { ...base, direction: "host-command", requestId: "request-1", command: "send", text: "ok", cwd: "   " },
    { ...base, direction: "host-command", requestId: "request-1", command: "deleteThread" },
    { ...base, direction: "iframe-command", requestId: "request-1", command: "stop" },
    { ...base, version: 2, direction: "host-command", requestId: "request-1", command: "stop" },
  ])("rejects an invalid or foreign host command", (command) => {
    expect(isCodexEmbedCommand(command)).toBe(false);
  });

  it("matches the bridge's exact browser-origin policy", () => {
    expect(isAllowedCodexEmbedHostOrigin("http://localhost:3000")).toBe(false);
    expect(isAllowedCodexEmbedHostOrigin("https://127.0.0.1:8443")).toBe(false);
    expect(isAllowedCodexEmbedHostOrigin("http://localhost:3000", [], true)).toBe(true);
    expect(isAllowedCodexEmbedHostOrigin("https://127.0.0.1:8443", [], true)).toBe(true);
    expect(isAllowedCodexEmbedHostOrigin("https://canvas.example.com", ["https://canvas.example.com"])).toBe(true);
    expect(isAllowedCodexEmbedHostOrigin("null", ["null"])).toBe(true);
    expect(isAllowedCodexEmbedHostOrigin("https://sibling.example.com", ["https://canvas.example.com"])).toBe(false);
    expect(isAllowedCodexEmbedHostOrigin("null")).toBe(false);
    expect(isAllowedCodexEmbedHostOrigin("not an origin", ["https://canvas.example.com"])).toBe(false);
  });

  it("rejects an invalid controller timeout before touching the iframe", () => {
    expect(() => createCodexEmbedController({} as HTMLIFrameElement, { timeoutMs: 0 })).toThrow("positive number");
    expect(() => createCodexEmbedController({} as HTMLIFrameElement, { timeoutMs: Number.POSITIVE_INFINITY })).toThrow("positive number");
  });
});
