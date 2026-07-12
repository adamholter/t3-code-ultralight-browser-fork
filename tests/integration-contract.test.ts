import { describe, expect, it } from "vitest";
import integration from "../integration.json";
import { createIntegrationRecipe, materializeRuntimeIntegrationContract } from "../server/integration-contract";

describe("live integration contract", () => {
  it("rewrites every bridge address and lifecycle command for an alternate port", () => {
    const runtime = materializeRuntimeIntegrationContract(integration, { port: 49123 });

    expect(runtime.bridge).toMatchObject({
      port: 49123,
      httpUrl: "http://127.0.0.1:49123",
      websocketUrl: "ws://127.0.0.1:49123/ws",
      commands: {
        status: "t3-code-ultralight status --port 49123 --json",
        stop: "t3-code-ultralight stop --port 49123 --json",
        foreground: "t3-code-ultralight serve --port 49123",
      },
    });
    expect(runtime.release.startCommand).toContain("start --port 49123 --json");
    expect(runtime.release.setupCommands.custom).toContain("setup --mode custom --port 49123 --json");
    expect(runtime.modes.completeChat).toMatchObject({
      iframeUrl: "http://127.0.0.1:49123/?embed=1",
      webComponentModule: "http://127.0.0.1:49123/codex-chat.js",
    });
    expect(runtime.modes.customUi).toMatchObject({
      browserModule: "http://127.0.0.1:49123/codex-client.js",
      requestModule: "http://127.0.0.1:49123/codex-requests.js",
    });
    expect(runtime.runtime).toEqual({ live: true, port: 49123, origin: "http://127.0.0.1:49123" });
    expect(integration.bridge.port).toBe(4174);
  });

  it("keeps default-port commands concise", () => {
    const runtime = materializeRuntimeIntegrationContract(integration, { port: 4174 });
    expect(runtime.bridge.commands.status).toBe("t3-code-ultralight status --json");
    expect(runtime.release.startCommand).toContain(" start --json");
  });

  it("creates complete copyable recipes for every supported host style", () => {
    const iframe = createIntegrationRecipe(integration, { mode: "iframe", port: 4174 });
    expect(iframe).toMatchObject({ mode: "iframe", requiresPackageInstall: false, embedUrl: "http://127.0.0.1:4174/?embed=1" });
    expect(iframe.code).toContain("<iframe");

    const react = createIntegrationRecipe(integration, { mode: "react", port: 49123 });
    expect(react).toMatchObject({ mode: "react", requiresPackageInstall: true, bridgeUrl: "http://127.0.0.1:49123" });
    expect(react.installCommand).toContain(`?v=${integration.version}`);
    expect(react.code).toContain('bridgeUrl="http://127.0.0.1:49123"');

    const element = createIntegrationRecipe(integration, { mode: "element", port: 4174 });
    expect(element.code).toContain('document.createElement("codex-chat")');

    const custom = createIntegrationRecipe(integration, { mode: "custom", port: 49123, cwd: "/repo" });
    expect(custom).toMatchObject({ mode: "custom", dispose: "detachRequests(); await codex.close();" });
    expect(custom.code).toContain('bridgeUrl: "http://127.0.0.1:49123"');
    expect(custom.code).toContain('cwd: "/repo"');
    expect(custom.hostedModules.client).toBe("http://127.0.0.1:49123/codex-client.js");
  });
});
