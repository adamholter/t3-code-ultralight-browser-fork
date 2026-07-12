export interface RuntimeIntegrationOptions {
  port: number;
}

export type IntegrationRecipeMode = "iframe" | "react" | "element" | "custom";

export interface IntegrationRecipeOptions extends RuntimeIntegrationOptions {
  mode: IntegrationRecipeMode;
  cwd?: string;
}

interface IntegrationRecipeBase {
  bridgeUrl: string;
  statusUrl: string;
  integrationUrl: string;
  verify: string;
  code: string;
}

export interface IframeIntegrationRecipe extends IntegrationRecipeBase {
  mode: "iframe";
  requiresPackageInstall: false;
  embedUrl: string;
}

export interface ReactIntegrationRecipe extends IntegrationRecipeBase {
  mode: "react";
  requiresPackageInstall: true;
  installCommand: string;
  packageExport: string;
}

export interface ElementIntegrationRecipe extends IntegrationRecipeBase {
  mode: "element";
  requiresPackageInstall: true;
  installCommand: string;
  packageExport: string;
  hostedModule: string;
}

export interface CustomIntegrationRecipe extends IntegrationRecipeBase {
  mode: "custom";
  requiresPackageInstall: true;
  installCommand: string;
  packageExports: string[];
  hostedModules: { client: string; requests: string };
  dispose: string;
}

export type IntegrationRecipe = IframeIntegrationRecipe | ReactIntegrationRecipe | ElementIntegrationRecipe | CustomIntegrationRecipe;

/** Rewrite the packaged default-port contract for the bridge that is actually serving it. */
export function materializeRuntimeIntegrationContract(
  contract: Record<string, any>,
  { port }: RuntimeIntegrationOptions,
) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Runtime integration port must be an integer from 1 to 65535");
  }
  const value = structuredClone(contract);
  const origin = `http://127.0.0.1:${port}`;
  const socketOrigin = `ws://127.0.0.1:${port}`;
  const portArgument = port === 4174 ? "" : ` --port ${port}`;

  value.bridge.port = port;
  value.bridge.httpUrl = origin;
  value.bridge.websocketUrl = `${socketOrigin}/ws`;
  value.bridge.commands.status = `t3-code-ultralight status${portArgument} --json`;
  value.bridge.commands.stop = `t3-code-ultralight stop${portArgument} --json`;
  value.bridge.commands.foreground = `t3-code-ultralight serve${portArgument}`;
  value.release.startCommand = `npx --yes '${value.release.specifier}' start${portArgument} --json`;
  value.release.setupCommands ??= {};
  for (const mode of ["iframe", "react", "element", "custom"]) {
    value.release.setupCommands[mode] = `npx --yes '${value.release.specifier}' setup --mode ${mode}${portArgument} --json`;
  }
  value.modes.completeChat.iframeUrl = `${origin}/?embed=1`;
  value.modes.completeChat.webComponentModule = `${origin}/codex-chat.js`;
  value.modes.customUi.browserModule = `${origin}/codex-client.js`;
  value.modes.customUi.requestModule = `${origin}/codex-requests.js`;
  value.runtime = {
    live: true,
    port,
    origin,
  };
  return value;
}

/** Produce one complete, copyable host recipe from the same machine contract agents inspect. */
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptions & { mode: "iframe" }): IframeIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptions & { mode: "react" }): ReactIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptions & { mode: "element" }): ElementIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptions & { mode: "custom" }): CustomIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptions): IntegrationRecipe;
export function createIntegrationRecipe(
  contract: Record<string, any>,
  { mode, port, cwd }: IntegrationRecipeOptions,
): IntegrationRecipe {
  const runtime = materializeRuntimeIntegrationContract(contract, { port });
  const bridgeUrl = runtime.bridge.httpUrl as string;
  const specifier = runtime.release.specifier as string;
  const installCommand = `npm install '${specifier}'`;
  const workingDirectory = cwd ?? "/absolute/project/path";
  const shared = {
    mode,
    bridgeUrl,
    statusUrl: `${bridgeUrl}${runtime.bridge.statusPath}`,
    integrationUrl: `${bridgeUrl}${runtime.bridge.integrationPath}`,
    verify: "Send one real turn through the final user-facing UI and confirm streamed output plus stop behavior.",
  };

  if (mode === "iframe") {
    return {
      ...shared,
      mode: "iframe",
      requiresPackageInstall: false,
      embedUrl: runtime.modes.completeChat.iframeUrl,
      code: `<iframe src="${runtime.modes.completeChat.iframeUrl}" title="Local Codex chat" style="width:100%;height:100%;min-height:420px;border:0"></iframe>`,
    };
  }
  if (mode === "react") {
    return {
      ...shared,
      mode: "react",
      requiresPackageInstall: true,
      installCommand,
      packageExport: "t3-code-ultralight-browser-fork/react",
      code: `import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";\n\nexport function CodexPanel() {\n  return <CodexChatEmbed bridgeUrl="${bridgeUrl}" style={{ height: 640 }} />;\n}`,
    };
  }
  if (mode === "element") {
    return {
      ...shared,
      mode: "element",
      requiresPackageInstall: true,
      installCommand,
      packageExport: "t3-code-ultralight-browser-fork/element/auto",
      hostedModule: runtime.modes.completeChat.webComponentModule,
      code: `import "t3-code-ultralight-browser-fork/element/auto";\n\nexport function mountCodexChat(container: HTMLElement) {\n  const chat = document.createElement("codex-chat");\n  chat.setAttribute("bridge-url", "${bridgeUrl}");\n  chat.setAttribute("min-height", "560px");\n  container.append(chat);\n  return chat;\n}`,
    };
  }
  return {
    ...shared,
    mode: "custom",
    requiresPackageInstall: true,
    installCommand,
    packageExports: runtime.modes.customUi.packageExports,
    hostedModules: {
      client: runtime.modes.customUi.browserModule,
      requests: runtime.modes.customUi.requestModule,
    },
      code: `import { createCodexSession } from "t3-code-ultralight-browser-fork/client";\nimport { attachCodexSessionRequestHandlers } from "t3-code-ultralight-browser-fork/requests";\n\nconst codex = createCodexSession({ bridgeUrl: "${bridgeUrl}", cwd: ${JSON.stringify(workingDirectory)} });\nconst detachRequests = attachCodexSessionRequestHandlers(codex, {\n  approval: async (request) => await yourUI.reviewApproval(request) ? "accept" : "decline",\n  userInput: (questions) => yourUI.ask(questions),\n});\n\nconst answer = await codex.send(prompt, {\n  onDelta: (_delta, text) => yourUI.renderStreamingText(text),\n});\n\n// Final disposal:\n// detachRequests();\n// await codex.close();`,
    dispose: "detachRequests(); await codex.close();",
  };
}
