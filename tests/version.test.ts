import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import packageJson from "../package.json";
import { PACKAGE_VERSION } from "../server/version";

describe("package version", () => {
  it("keeps runtime diagnostics aligned with package metadata", () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });

  it("cache-keys mutable latest-release URLs with the package version", () => {
    const cacheKey = `t3-code-ultralight-browser-fork.tgz?v=${packageJson.version}`;
    expect(readFileSync(new URL("../README.md", import.meta.url), "utf8")).toContain(cacheKey);
    expect(readFileSync(new URL("../docs/AGENT_INTEGRATION.md", import.meta.url), "utf8")).toContain(cacheKey);
  });
});
