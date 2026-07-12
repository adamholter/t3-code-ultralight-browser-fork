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
});
