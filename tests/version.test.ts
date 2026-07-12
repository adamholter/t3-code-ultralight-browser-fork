import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { PACKAGE_VERSION } from "../server/version";

describe("package version", () => {
  it("keeps runtime diagnostics aligned with package metadata", () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });
});
