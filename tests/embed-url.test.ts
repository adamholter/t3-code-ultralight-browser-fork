import { describe, expect, it } from "vitest";
import { buildEmbedUrl } from "../src/embed-url";

describe("buildEmbedUrl", () => {
  it.each([
    ["/codex", "/codex?embed=1"],
    ["/codex?theme=dark", "/codex?theme=dark&embed=1"],
    ["/codex?embed=0#chat", "/codex?embed=1#chat"],
    ["http://127.0.0.1:4174", "http://127.0.0.1:4174?embed=1"],
  ])("builds an SSR-safe embed URL from %s", (input, output) => {
    expect(buildEmbedUrl(input)).toBe(output);
  });

  it("passes same-origin bridge paths to the isolated chat", () => {
    expect(buildEmbedUrl("https://sidecar.example/chat?token=secret", {
      websocketPath: "/codex/secret/ws",
      statusPath: "/api/codex-status?token=secret",
    })).toBe("https://sidecar.example/chat?token=secret&embed=1&codex-ws-path=%2Fcodex%2Fsecret%2Fws&codex-status-path=%2Fapi%2Fcodex-status%3Ftoken%3Dsecret");
  });

  it("rejects cross-origin path overrides", () => {
    expect(() => buildEmbedUrl("https://sidecar.example", { websocketPath: "//evil.example/ws" })).toThrow(/same-origin/);
  });
});
