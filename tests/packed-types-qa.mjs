import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const { version } = packageJson;
const packagePath = resolve(process.argv[2] ?? `release/t3-code-ultralight-browser-fork-${version}.tgz`);
const fixture = await mkdtemp(resolve(tmpdir(), "t3-ultralight-types-"));
const expectedExports = [".", "./client", "./assistant", "./react", "./element", "./element/auto", "./embed-events", "./server", "./doctor", "./integration", "./requests", "./types"];

try {
  if (JSON.stringify(Object.keys(packageJson.exports)) !== JSON.stringify(expectedExports)) {
    throw new Error(`Update packed export coverage for: ${Object.keys(packageJson.exports).join(", ")}`);
  }
  const install = spawnSync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    packagePath,
    "@types/node@24.13.3",
  ], {
    cwd: fixture,
    encoding: "utf8",
  });
  if (install.status !== 0) throw new Error(install.stderr || install.stdout);

  await writeFile(resolve(fixture, "consumer.ts"), `
import {
  createCodexClient,
  createCodexSession,
  type CodexClientEventMap,
} from "t3-code-ultralight-browser-fork/client";
import { attachCodexSessionRequestHandlers } from "t3-code-ultralight-browser-fork/requests";
import { createCodexAssistant, type CodexAssistantOptions } from "t3-code-ultralight-browser-fork/assistant";
import { createIntegrationRecipe } from "t3-code-ultralight-browser-fork/integration";
import { createCodexEmbedController } from "t3-code-ultralight-browser-fork/embed-events";
import {
  attachCodexBridge,
  DEFAULT_BROWSER_SOCKET_CLOSE_TIMEOUT_MS,
  type AttachCodexBridgeOptions,
} from "t3-code-ultralight-browser-fork/server";
import type { Server } from "node:http";

declare const httpServer: Server;
const attachedOptions: AttachCodexBridgeOptions = { autoStart: false, browserSocketCloseTimeoutMs: 750, allowedOrigins: ["http://127.0.0.1:3000"], allowLoopbackOrigins: false };
const attachedController = attachCodexBridge(httpServer, attachedOptions);
const defaultSocketCloseTimeout: 1000 = DEFAULT_BROWSER_SOCKET_CLOSE_TIMEOUT_MS;
void [attachedController, defaultSocketCloseTimeout];

const client = createCodexClient();
const canvas = createCodexSession({ client, cwd: "/workspace" });
const assistantOptions: CodexAssistantOptions = { client, requestHandlers: { approval: () => "decline" } };
const assistant = createCodexAssistant(assistantOptions);
void assistant.close();
declare const iframe: HTMLIFrameElement;
const embed = createCodexEmbedController(iframe);
void embed.send("Explain the selection", { cwd: "/workspace", newThread: true });

client.on("item/agentMessage/delta", (event) => {
  const delta: string = event.delta;
  void delta;
});

client.on("future/protocol/event", (event) => void event.futureValue);

const detach = attachCodexSessionRequestHandlers(canvas, {
  approval: () => "decline",
});
void detach;

const turnStarted: CodexClientEventMap["turn/started"] = {
  threadId: "thread",
  turn: { id: "turn" },
};
void turnStarted;

declare const contract: Record<string, any>;
const recipe = createIntegrationRecipe(contract, { mode: "custom", port: 4174, cwd: "/workspace" });
const installCommand: string = recipe.installCommand;
const clientModule: string = recipe.hostedModules.client;
const assistantModule: string = recipe.hostedModules.assistant;
void [installCommand, clientModule, assistantModule];

const iframeRecipe = createIntegrationRecipe(contract, { mode: "iframe", port: 4174, cwd: "/workspace" });
const controllerModule: string = iframeRecipe.controllerModule;
const controllerCode: string = iframeRecipe.controllerCode;
const controllerDispose: "codex.dispose()" = iframeRecipe.controllerDispose;
void [controllerModule, controllerCode, controllerDispose];

const hostedRecipe = createIntegrationRecipe(contract, { mode: "custom", delivery: "hosted", port: 4174 });
const hostedInstall: false = hostedRecipe.requiresPackageInstall;
const hostedClient: string = hostedRecipe.hostedModules.client;
const hostedAssistant: string = hostedRecipe.hostedModules.assistant;
const workspaceDefault: "bridge" = hostedRecipe.workspace.default;
const workspaceOverrideEmbedded: boolean = hostedRecipe.workspace.overrideEmbedded;
const originFlag: "--allow-origin <exact browser origin>" = hostedRecipe.originPolicy.nonLoopbackRequiresExactFlag;
const browserOriginFlag: "--allow-origin <exact browser origin>" = hostedRecipe.originPolicy.browserHostRequiresExactFlag;
const opaqueOriginAllowed: boolean = hostedRecipe.originPolicy.opaqueOriginAllowed;
void [hostedInstall, hostedClient, hostedAssistant, workspaceDefault, workspaceOverrideEmbedded, originFlag, browserOriginFlag, opaqueOriginAllowed];

// @ts-expect-error Hosted recipes intentionally have no package install command.
void hostedRecipe.installCommand;

// @ts-expect-error Setup modes are intentionally finite and typo-safe.
createIntegrationRecipe(contract, { mode: "canvas", port: 4174 });

// @ts-expect-error Known events must not fall through to the untyped escape hatch.
client.on("connection", (status: number) => void status);
`);
  await writeFile(resolve(fixture, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022", "DOM"],
      skipLibCheck: false,
    },
    include: ["consumer.ts"],
  }, null, 2));

  const compiler = resolve(process.cwd(), "node_modules/.bin/tsc");
  const compile = spawnSync(compiler, ["--project", "tsconfig.json"], { cwd: fixture, encoding: "utf8" });
  if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout);
  if (existsSync(resolve(fixture, "node_modules/@types/ws"))) throw new Error("Packed server types unexpectedly require @types/ws");

  await writeFile(resolve(fixture, "runtime.mjs"), `
const allExports = ${JSON.stringify(expectedExports)};
const expected = process.env.INCLUDE_REACT === "1"
  ? allExports
  : allExports.filter((subpath) => subpath !== "./react");
const modules = new Map();
for (const subpath of expected) {
  const specifier = subpath === "."
    ? "t3-code-ultralight-browser-fork"
    : "t3-code-ultralight-browser-fork" + subpath.slice(1);
  modules.set(subpath, await import(specifier));
}
const required = {
  ".": "createCodexSession",
  "./client": "createCodexClient",
  "./assistant": "createCodexAssistant",
  "./react": "CodexChatEmbed",
  "./element": "defineCodexChatElement",
  "./element/auto": "defineCodexChatElement",
  "./embed-events": "createCodexEmbedController",
  "./server": "attachCodexBridge",
  "./doctor": "runDoctor",
  "./integration": "createIntegrationRecipe",
  "./requests": "attachCodexRequestHandlers",
};
for (const [subpath, symbol] of Object.entries(required)) {
  if (!expected.includes(subpath)) continue;
  if (typeof modules.get(subpath)?.[symbol] !== "function") {
    throw new Error(\`Missing runtime export \${subpath}:\${symbol}\`);
  }
}
console.log(JSON.stringify({ runtimeExports: expected, ssrSafeElementAuto: true }));
`);
  const headlessRuntime = spawnSync(process.execPath, ["runtime.mjs"], { cwd: fixture, encoding: "utf8" });
  if (headlessRuntime.status !== 0) throw new Error(headlessRuntime.stderr || headlessRuntime.stdout);

  const installReact = spawnSync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    resolve("node_modules/react"),
  ], { cwd: fixture, encoding: "utf8" });
  if (installReact.status !== 0) throw new Error(installReact.stderr || installReact.stdout);
  const reactRuntime = spawnSync(process.execPath, ["runtime.mjs"], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, INCLUDE_REACT: "1" },
  });
  if (reactRuntime.status !== 0) throw new Error(reactRuntime.stderr || reactRuntime.stdout);

  const cli = resolve(fixture, "node_modules/.bin/t3-code-ultralight");
  const help = spawnSync(cli, ["--help"], { cwd: fixture, encoding: "utf8" });
  if (help.status !== 0 || !help.stdout.includes("setup")) throw new Error(help.stderr || help.stdout || "Packed CLI help failed");
  const integration = spawnSync(cli, ["integration"], { cwd: fixture, encoding: "utf8" });
  if (integration.status !== 0 || JSON.parse(integration.stdout).version !== version) {
    throw new Error(integration.stderr || integration.stdout || "Packed CLI integration contract failed");
  }

  console.log(JSON.stringify({
    packagePath,
    packageImport: true,
    knownEventsTyped: true,
    unknownEventsCompatible: true,
    integrationRecipesTyped: true,
    runtimeExports: expectedExports,
    headlessWithoutReact: true,
    optionalReactPeer: true,
    serverTypesWithoutWsTypePackage: true,
    cliEntrypoint: true,
  }, null, 2));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
