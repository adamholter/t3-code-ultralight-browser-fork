import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import packageJson from "../package.json";
import integration from "../integration.json";
import { PACKAGE_VERSION } from "../server/version";

describe("package version", () => {
  it("keeps runtime diagnostics aligned with package metadata", () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
    expect(integration.version).toBe(packageJson.version);
    expect(integration.name).toBe(packageJson.name);
  });

  it("cache-keys mutable latest-release URLs with the package version", () => {
    const cacheKey = `t3-code-ultralight-browser-fork.tgz?v=${packageJson.version}`;
    expect(readFileSync(new URL("../README.md", import.meta.url), "utf8")).toContain(cacheKey);
    expect(readFileSync(new URL("../docs/AGENT_INTEGRATION.md", import.meta.url), "utf8")).toContain(cacheKey);
    expect(integration.release.specifier).toContain(cacheKey);
    expect(Object.values(integration.release.setupCommands).every((command) => command.includes(cacheKey))).toBe(true);
  });

  it("publishes a complete machine-readable integration contract", () => {
    expect(integration.schemaVersion).toBe(1);
    expect(Object.keys(integration.modes)).toEqual(["completeChat", "customUi", "attachedServer"]);
    expect(integration.bridge).toMatchObject({ bind: "127.0.0.1", port: 4174, integrationPath: "/api/integration" });
    expect(integration.security).toMatchObject({ loopbackOnly: true, browserCredentials: false, wildcardOrigins: false });
    expect(integration.acceptance).toContain("one real local Codex turn streams through the final user-facing UI");
    expect(packageJson.files).toEqual(expect.arrayContaining(["integration.json", "llms.txt"]));
    expect(packageJson.exports).toHaveProperty("./integration");
  });

  it("keeps React optional for headless installs while declaring the wrapper peer", () => {
    expect(packageJson.peerDependencies).toMatchObject({ react: "^18.0.0 || ^19.0.0" });
    expect(packageJson.peerDependenciesMeta).toMatchObject({ react: { optional: true } });
  });

  it("gates standard checks on a fresh packed consumer", () => {
    expect(packageJson.scripts.check).toContain("check:packed");
    expect(packageJson.scripts["check:packed"]).toContain("npm run build");
    expect(packageJson.scripts["check:packed"]).toContain("check-packed-consumer.mjs");
  });
});
