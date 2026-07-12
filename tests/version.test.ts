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
    expect(Object.values(integration.release.setupCommands).every((command) => command.includes("--allow-origin '{BROWSER_ORIGIN}'"))).toBe(true);
    expect(integration.release.startCommand).toContain("--allow-origin '{BROWSER_ORIGIN}'");
  });

  it("publishes a complete machine-readable integration contract", () => {
    expect(integration.schemaVersion).toBe(1);
    expect(integration.requirements).toMatchObject({
      node: ">=22",
      supportedNodeMajors: [22, 24, 26],
      runtimePolicy: "currently supported Node.js releases",
      operatingSystems: ["linux", "macos", "windows"],
    });
    expect(Object.keys(integration.modes)).toEqual(["completeChat", "customUi", "attachedServer"]);
    expect(integration.bridge).toMatchObject({ bind: "127.0.0.1", port: 4174, integrationPath: "/api/integration" });
    expect(integration.bridge.codexBinary).toMatchObject({
      overrideFlag: "--codex <command or path>",
      diagnosticAndRuntimeMatch: true,
      browserPathDisclosure: false,
    });
    expect(integration.bridge.browserOrigins).toMatchObject({
      setupRequiresPolicy: true,
      exactFlag: "--allow-origin <exact browser origin>",
      broadLoopbackCompatibilityFlag: "--allow-loopback-origins",
    });
    expect(integration.bridge.automaticPort).toMatchObject({
      compatibleBridgeReuse: true,
      existingCompatibleBridgePreferred: true,
    });
    expect(integration.security).toMatchObject({
      loopbackOnly: true,
      browserCredentials: false,
      wildcardOrigins: false,
      browserOriginsExactByDefault: true,
      bridgeSelfOriginAutomatic: true,
      broadLoopbackOriginsRequireOptIn: true,
      unlistedSiblingLoopbackRejected: true,
    });
    expect(integration.security).toMatchObject({
      exactCodexBinaryReuse: true,
      customCodexBinaryEndToEnd: true,
      codexBinaryPathDisclosure: false,
    });
    expect(integration.acceptance).toContain("one real local Codex turn streams through the final user-facing UI");
    expect(integration.modes.completeChat.webComponentCompatibility).toMatchObject({
      browserVerified: { vue: ["3.5.39"], svelte: ["5.56.4"] },
      singleMountInitializationVerified: true,
      preReadyControllerVerified: true,
    });
    expect(integration.modes.completeChat.reactCompatibility).toMatchObject({
      clientDirective: true,
      nextAppRouterVerified: ["16.2.10"],
      serverComponentImportVerified: true,
      productionBuildVerified: true,
    });
    expect(packageJson.files).toEqual(expect.arrayContaining(["integration.json", "llms.txt"]));
    expect(packageJson.exports).toHaveProperty("./integration");
    expect(packageJson.exports).toHaveProperty("./assistant");
    expect(integration.modes.customUi).toMatchObject({
      primaryApi: "createCodexAssistant",
      requestAdapterOwnedByAssistant: true,
      missingRequestHandlersFailClosed: true,
      dispose: "await assistant.close()",
    });
    expect(integration.release.verification).toMatchObject({
      workflow: ".github/workflows/release.yml",
      cleanCheckout: true,
      standardChecks: true,
      productionAudit: true,
      npmPublishDryRun: true,
      githubProvenanceAttestation: true,
      verifiedAssetReplacement: true,
    });
    expect(integration.release.setupReceiptLifecycle).toMatchObject({
      requiredBeforeBrowser: true,
      exactResolvedPort: true,
      exactWorkspace: true,
      exactCodexBinary: true,
      exactBrowserOriginPolicy: true,
      installedAndZeroInstallCommands: true,
      idempotentEnsure: true,
      restartBrowserVerified: true,
    });
    expect(integration.security.durableLifecycleReceipt).toBe(true);
    expect(integration.security.attestedReleaseArtifacts).toBe(true);
    expect(integration.security.windowsBatchCodexLaunch).toBe(true);
  });

  it("keeps public registry metadata and release automation fail-closed", () => {
    expect(packageJson.publishConfig).toEqual({ access: "public", provenance: true });
    const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("types: [published]");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("npm publish \"$PWD/release/$tarball\" --dry-run --json");
    expect(workflow).toContain("actions/attest-build-provenance@v4.1.1");
    expect(workflow).toContain("gh release upload \"$RELEASE_TAG\" release/*.tgz --clobber");
    expect(workflow).toContain("if: ${{ vars.NPM_PUBLISH_ENABLED == 'true' && env.NODE_AUTH_TOKEN != '' }}");
  });

  it("checks every supported Node major and desktop OS", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(workflow).toContain("os: ubuntu-latest");
    expect(workflow).toContain("os: macos-latest");
    expect(workflow).toContain("os: windows-latest");
    expect(workflow).toContain("node-version: ${{ matrix.node }}");
    expect(integration.release.verification).toMatchObject({
      nodeMatrix: [22, 24, 26],
      operatingSystemMatrix: ["ubuntu-latest", "macos-latest", "windows-latest"],
      packedConsumerPerRuntime: true,
      codexProcessSmokePerOperatingSystem: true,
    });
  });

  it("keeps React optional for headless installs while declaring the wrapper peer", () => {
    expect(packageJson.peerDependencies).toMatchObject({ react: "^18.0.0 || ^19.0.0" });
    expect(packageJson.peerDependenciesMeta).toMatchObject({ react: { optional: true } });
  });

  it("gates standard checks on a fresh packed consumer", () => {
    expect(packageJson.scripts.check).toContain("check:packed");
    expect(packageJson.scripts.check).toContain("check:platform");
    expect(packageJson.scripts["check:packed"]).toContain("npm run build");
    expect(packageJson.scripts["check:packed"]).toContain("check-packed-consumer.mjs");
    expect(packageJson.scripts["check:platform"]).toContain("check-platform-runtime.mjs");
  });
});
