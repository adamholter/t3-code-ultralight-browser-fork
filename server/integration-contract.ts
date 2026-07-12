export interface RuntimeIntegrationOptions {
  port: number;
}

export type IntegrationRecipeMode = "iframe" | "react" | "element" | "custom";
export type IntegrationRecipeDelivery = "package" | "hosted";

interface IntegrationRecipeOptionBase extends RuntimeIntegrationOptions {
  cwd?: string;
  allowedOrigins?: readonly string[];
}

export type IntegrationRecipeOptions =
  | (IntegrationRecipeOptionBase & { mode: "iframe"; delivery?: "hosted" })
  | (IntegrationRecipeOptionBase & { mode: "react"; delivery?: "package" })
  | (IntegrationRecipeOptionBase & { mode: "element"; delivery?: "package" })
  | (IntegrationRecipeOptionBase & { mode: "element"; delivery: "hosted" })
  | (IntegrationRecipeOptionBase & { mode: "custom"; delivery?: "package" })
  | (IntegrationRecipeOptionBase & { mode: "custom"; delivery: "hosted" });

interface IntegrationRecipeBase {
  bridgeUrl: string;
  statusUrl: string;
  integrationUrl: string;
  verify: string;
  code: string;
  codeLanguage: "html" | "js" | "ts" | "tsx";
  csp: Record<string, string[]>;
  originPolicy: {
    loopbackAutomatic: true;
    additionalAllowedOrigins: string[];
    opaqueOriginAllowed: boolean;
    nonLoopbackRequiresExactFlag: "--allow-origin <exact browser origin>";
  };
}

export interface IframeIntegrationRecipe extends IntegrationRecipeBase {
  mode: "iframe";
  delivery: "hosted";
  requiresPackageInstall: false;
  embedUrl: string;
  controllerModule: string;
  controllerCode: string;
  controllerCodeLanguage: "js";
  controllerDispose: "codex.dispose()";
}

export interface ReactIntegrationRecipe extends IntegrationRecipeBase {
  mode: "react";
  delivery: "package";
  requiresPackageInstall: true;
  installCommand: string;
  packageExport: string;
}

interface ElementIntegrationRecipeBase extends IntegrationRecipeBase {
  mode: "element";
  hostedModule: string;
}

export interface ElementPackageIntegrationRecipe extends ElementIntegrationRecipeBase {
  delivery: "package";
  requiresPackageInstall: true;
  installCommand: string;
  packageExport: string;
}

export interface ElementHostedIntegrationRecipe extends ElementIntegrationRecipeBase {
  delivery: "hosted";
  requiresPackageInstall: false;
}

export type ElementIntegrationRecipe = ElementPackageIntegrationRecipe | ElementHostedIntegrationRecipe;

interface CustomIntegrationRecipeBase extends IntegrationRecipeBase {
  mode: "custom";
  hostedModules: { client: string; requests: string };
  dispose: string;
}

export interface CustomPackageIntegrationRecipe extends CustomIntegrationRecipeBase {
  delivery: "package";
  requiresPackageInstall: true;
  installCommand: string;
  packageExports: string[];
}

export interface CustomHostedIntegrationRecipe extends CustomIntegrationRecipeBase {
  delivery: "hosted";
  requiresPackageInstall: false;
}

export type CustomIntegrationRecipe = CustomPackageIntegrationRecipe | CustomHostedIntegrationRecipe;

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
  value.release.setupCommands.elementHosted = `npx --yes '${value.release.specifier}' setup --mode element --delivery hosted${portArgument} --json`;
  value.release.setupCommands.customHosted = `npx --yes '${value.release.specifier}' setup --mode custom --delivery hosted${portArgument} --json`;
  value.modes.completeChat.iframeUrl = `${origin}/?embed=1`;
  value.modes.completeChat.webComponentModule = `${origin}/codex-chat.js`;
  value.modes.completeChat.controllerModule = `${origin}/codex-embed.js`;
  value.modes.customUi.browserModule = `${origin}/codex-client.js`;
  value.modes.customUi.requestModule = `${origin}/codex-requests.js`;
  value.runtime = {
    live: true,
    port,
    origin,
    workspace: { default: "bridge", pathDisclosed: false },
  };
  return value;
}

/** Produce one complete, copyable host recipe from the same machine contract agents inspect. */
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptionBase & { mode: "iframe"; delivery?: "hosted" }): IframeIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptionBase & { mode: "react"; delivery?: "package" }): ReactIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptionBase & { mode: "element"; delivery?: "package" }): ElementPackageIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptionBase & { mode: "element"; delivery: "hosted" }): ElementHostedIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptionBase & { mode: "custom"; delivery?: "package" }): CustomPackageIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptionBase & { mode: "custom"; delivery: "hosted" }): CustomHostedIntegrationRecipe;
export function createIntegrationRecipe(contract: Record<string, any>, options: IntegrationRecipeOptions): IntegrationRecipe;
export function createIntegrationRecipe(
  contract: Record<string, any>,
  { mode, port, cwd, delivery: requestedDelivery, allowedOrigins = [] }: IntegrationRecipeOptions,
): IntegrationRecipe {
  const runtime = materializeRuntimeIntegrationContract(contract, { port });
  const bridgeUrl = runtime.bridge.httpUrl as string;
  const specifier = runtime.release.specifier as string;
  const installCommand = `npm install '${specifier}'`;
  const workingDirectory = cwd?.trim();
  const socketUrl = runtime.bridge.websocketUrl as string;
  const socketOrigin = new URL(socketUrl).origin;
  const uniqueAllowedOrigins = [...new Set(allowedOrigins)];
  const shared = {
    bridgeUrl,
    statusUrl: `${bridgeUrl}${runtime.bridge.statusPath}`,
    integrationUrl: `${bridgeUrl}${runtime.bridge.integrationPath}`,
    verify: "Send one real turn through the final user-facing UI and confirm streamed output plus stop behavior.",
    originPolicy: {
      loopbackAutomatic: true as const,
      additionalAllowedOrigins: uniqueAllowedOrigins,
      opaqueOriginAllowed: uniqueAllowedOrigins.includes("null"),
      nonLoopbackRequiresExactFlag: "--allow-origin <exact browser origin>" as const,
    },
  };

  if (mode === "iframe") {
    assertDelivery(mode, requestedDelivery, "hosted");
    return {
      ...shared,
      mode: "iframe",
      delivery: "hosted",
      requiresPackageInstall: false,
      embedUrl: runtime.modes.completeChat.iframeUrl,
      controllerModule: runtime.modes.completeChat.controllerModule,
      controllerCode: `import { createCodexEmbedController } from "${runtime.modes.completeChat.controllerModule}";\n\nconst iframe = document.querySelector("#local-codex");\nconst codex = createCodexEmbedController(iframe);\nawait codex.send("Explain the current selection"${workingDirectory ? `, { cwd: ${JSON.stringify(workingDirectory)} }` : ""});`,
      controllerCodeLanguage: "js",
      controllerDispose: "codex.dispose()",
      code: `<iframe id="local-codex" src="${runtime.modes.completeChat.iframeUrl}" title="Local Codex chat" style="width:100%;height:100%;min-height:420px;border:0"></iframe>`,
      codeLanguage: "html",
      csp: { "script-src": [bridgeUrl], "frame-src": [bridgeUrl] },
    };
  }
  if (mode === "react") {
    assertDelivery(mode, requestedDelivery, "package");
    return {
      ...shared,
      mode: "react",
      delivery: "package",
      requiresPackageInstall: true,
      installCommand,
      packageExport: "t3-code-ultralight-browser-fork/react",
      code: `import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";\n\nexport function CodexPanel() {\n  return <CodexChatEmbed bridgeUrl="${bridgeUrl}" style={{ height: 640 }} />;\n}`,
      codeLanguage: "tsx",
      csp: { "frame-src": [bridgeUrl] },
    };
  }
  if (mode === "element") {
    const delivery = requestedDelivery ?? "package";
    const hostedModule = runtime.modes.completeChat.webComponentModule as string;
    if (delivery === "hosted") {
      return {
        ...shared,
        mode: "element",
        delivery,
        requiresPackageInstall: false,
        hostedModule,
        code: `<script type="module" src="${hostedModule}"></script>\n<codex-chat bridge-url="${bridgeUrl}" min-height="560px"></codex-chat>`,
        codeLanguage: "html",
        csp: { "script-src": [bridgeUrl], "frame-src": [bridgeUrl] },
      };
    }
    return {
      ...shared,
      mode: "element",
      delivery,
      requiresPackageInstall: true,
      installCommand,
      packageExport: "t3-code-ultralight-browser-fork/element/auto",
      hostedModule,
      code: `import "t3-code-ultralight-browser-fork/element/auto";\n\nexport function mountCodexChat(container: HTMLElement) {\n  const chat = document.createElement("codex-chat");\n  chat.setAttribute("bridge-url", "${bridgeUrl}");\n  chat.setAttribute("min-height", "560px");\n  container.append(chat);\n  return chat;\n}`,
      codeLanguage: "ts",
      csp: { "frame-src": [bridgeUrl] },
    };
  }
  const delivery = requestedDelivery ?? "package";
  const hostedModules = {
    client: runtime.modes.customUi.browserModule as string,
    requests: runtime.modes.customUi.requestModule as string,
  };
  const imports = delivery === "hosted"
    ? `import { createCodexSession } from "${hostedModules.client}";\nimport { attachCodexSessionRequestHandlers } from "${hostedModules.requests}";`
    : `import { createCodexSession } from "t3-code-ultralight-browser-fork/client";\nimport { attachCodexSessionRequestHandlers } from "t3-code-ultralight-browser-fork/requests";`;
  const customCode = `${imports}\n\nconst codex = createCodexSession({ bridgeUrl: "${bridgeUrl}"${workingDirectory ? `, cwd: ${JSON.stringify(workingDirectory)}` : ""} });\nconst detachRequests = attachCodexSessionRequestHandlers(codex, {\n  approval: async (request) => await yourUI.reviewApproval(request) ? "accept" : "decline",\n  userInput: (questions) => yourUI.ask(questions),\n});\n\nconst answer = await codex.send(prompt, {\n  onDelta: (_delta, text) => yourUI.renderStreamingText(text),\n});\n\n// Final disposal:\n// detachRequests();\n// await codex.close();`;
  if (delivery === "hosted") {
    return {
      ...shared,
      mode: "custom",
      delivery,
      requiresPackageInstall: false,
      hostedModules,
      code: customCode,
      codeLanguage: "js",
      csp: { "script-src": [bridgeUrl], "connect-src": [socketOrigin] },
      dispose: "detachRequests(); await codex.close();",
    };
  }
  return {
    ...shared,
    mode: "custom",
    delivery,
    requiresPackageInstall: true,
    installCommand,
    packageExports: runtime.modes.customUi.packageExports,
    hostedModules,
    code: customCode,
    codeLanguage: "ts",
    csp: { "connect-src": [socketOrigin] },
    dispose: "detachRequests(); await codex.close();",
  };
}

function assertDelivery(mode: "iframe" | "react", requested: IntegrationRecipeDelivery | undefined, supported: IntegrationRecipeDelivery) {
  if (requested && requested !== supported) {
    throw new Error(`${mode} integrations support only --delivery ${supported}`);
  }
}
