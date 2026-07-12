import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("standalone app connection", () => {
  it("follows the origin and port that serve the bundled UI", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/createCodexClient\(\{\s*bridgeUrl:\s*\(\)\s*=>\s*window\.location\.origin\s*\}\)/);
  });
});
