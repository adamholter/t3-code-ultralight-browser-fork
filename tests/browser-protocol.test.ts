import { describe, expect, it } from "vitest";
import { parseBrowserBridgeMessage } from "../server/browser-protocol";
import { createCodexBridgeHello, parseCodexBridgeHello } from "../src/browser-contract";

describe("browser bridge message parser", () => {
  it("accepts the three protocol envelopes", () => {
    expect(parseBrowserBridgeMessage('{"type":"rpc","id":"one","method":"model/list","params":{}}')).toMatchObject({ type: "rpc", id: "one", method: "model/list" });
    expect(parseBrowserBridgeMessage('{"type":"respond","id":2,"result":{"decision":"accept"}}')).toMatchObject({ type: "respond", id: 2 });
    expect(parseBrowserBridgeMessage('{"type":"respondError","id":"three","error":"declined"}')).toEqual({ type: "respondError", id: "three", error: "declined" });
  });

  it.each([
    "not json",
    "[]",
    '{"type":"rpc","id":"","method":"model/list"}',
    '{"type":"rpc","id":"one","method":""}',
    '{"type":"respond","id":"one"}',
    '{"type":"respondError","id":"one","error":42}',
    '{"type":"unknown","id":"one"}',
  ])("rejects malformed input: %s", (raw) => {
    expect(() => parseBrowserBridgeMessage(raw)).toThrow();
  });
});

describe("browser bridge hello", () => {
  it("advertises a versioned protocol, capabilities, and active limits", () => {
    const hello = createCodexBridgeHello({
      bridgeVersion: "1.2.3",
      maxPayloadBytes: 4096,
      maxPendingRequestsPerClient: 8,
    });
    expect(parseCodexBridgeHello(hello)).toEqual({
      protocol: { major: 1, minor: 1 },
      bridgeVersion: "1.2.3",
      capabilities: ["rpc", "serverRequests", "requestOwnership", "threadIsolation", "transportLimits", "hostedModules"],
      limits: { maxPayloadBytes: 4096, maxPendingRequestsPerClient: 8 },
      legacy: false,
    });
  });

  it.each([
    null,
    { type: "hello", protocol: { major: -1, minor: 0 }, bridgeVersion: "x", capabilities: [], limits: { maxPayloadBytes: 1, maxPendingRequestsPerClient: 1 } },
    { type: "hello", protocol: { major: 1, minor: 0 }, bridgeVersion: "", capabilities: [], limits: { maxPayloadBytes: 1, maxPendingRequestsPerClient: 1 } },
    { type: "hello", protocol: { major: 1, minor: 0 }, bridgeVersion: "x", capabilities: [3], limits: { maxPayloadBytes: 1, maxPendingRequestsPerClient: 1 } },
    { type: "hello", protocol: { major: 1, minor: 0 }, bridgeVersion: "x", capabilities: [], limits: { maxPayloadBytes: 0, maxPendingRequestsPerClient: 1 } },
  ])("rejects malformed hello metadata", (value) => {
    expect(parseCodexBridgeHello(value)).toBeNull();
  });
});
