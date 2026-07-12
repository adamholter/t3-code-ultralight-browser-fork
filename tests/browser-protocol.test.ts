import { describe, expect, it } from "vitest";
import { parseBrowserBridgeMessage } from "../server/browser-protocol";

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
