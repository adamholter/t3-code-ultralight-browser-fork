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
    expect(runtime.release.setupCommands.customHosted).toContain("setup --mode custom --delivery hosted --port 49123 --json");
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
    expect(iframe).toMatchObject({ mode: "iframe", delivery: "hosted", requiresPackageInstall: false, embedUrl: "http://127.0.0.1:4174/?embed=1" });
    expect(iframe.code).toContain("<iframe");

    const react = createIntegrationRecipe(integration, { mode: "react", port: 49123 });
    expect(react).toMatchObject({ mode: "react", delivery: "package", requiresPackageInstall: true, bridgeUrl: "http://127.0.0.1:49123" });
    expect(react.installCommand).toContain(`?v=${integration.version}`);
    expect(react.code).toContain('bridgeUrl="http://127.0.0.1:49123"');

    const element = createIntegrationRecipe(integration, { mode: "element", port: 4174 });
    expect(element.code).toContain('document.createElement("codex-chat")');

    const hostedElement = createIntegrationRecipe(integration, { mode: "element", delivery: "hosted", port: 49123 });
    expect(hostedElement).toMatchObject({ delivery: "hosted", requiresPackageInstall: false, codeLanguage: "html" });
    expect(hostedElement.code).toContain('<script type="module" src="http://127.0.0.1:49123/codex-chat.js"></script>');
    expect(hostedElement.csp).toEqual({ "script-src": ["http://127.0.0.1:49123"], "frame-src": ["http://127.0.0.1:49123"] });

    const custom = createIntegrationRecipe(integration, { mode: "custom", port: 49123, cwd: "/repo" });
    expect(custom).toMatchObject({ mode: "custom", dispose: "detachRequests(); await codex.close();" });
    expect(custom.code).toContain('bridgeUrl: "http://127.0.0.1:49123"');
    expect(custom.code).toContain('cwd: "/repo"');
    expect(custom.hostedModules.client).toBe("http://127.0.0.1:49123/codex-client.js");

    const hostedCustom = createIntegrationRecipe(integration, { mode: "custom", delivery: "hosted", port: 49123, cwd: "/repo" });
    expect(hostedCustom).toMatchObject({ delivery: "hosted", requiresPackageInstall: false, codeLanguage: "js" });
    expect(hostedCustom.code).toContain('from "http://127.0.0.1:49123/codex-client.js"');
    expect(hostedCustom.code).toContain('from "http://127.0.0.1:49123/codex-requests.js"');
    expect(hostedCustom.csp).toEqual({ "script-src": ["http://127.0.0.1:49123"], "connect-src": ["ws://127.0.0.1:49123"] });

    const external = createIntegrationRecipe(integration, {
      mode: "custom",
      delivery: "hosted",
      port: 49123,
      allowedOrigins: ["https://canvas.example.com", "https://canvas.example.com"],
    });
    expect(external.originPolicy).toEqual({
      loopbackAutomatic: true,
      additionalAllowedOrigins: ["https://canvas.example.com"],
      nonLoopbackRequiresExactFlag: "--allow-origin <exact browser origin>",
    });

    expect(() => {
      // @ts-expect-error React intentionally rejects hosted delivery at compile time and runtime.
      return createIntegrationRecipe(integration, { mode: "react", delivery: "hosted", port: 4174 });
    }).toThrow("react integrations support only --delivery package");
  });
});
