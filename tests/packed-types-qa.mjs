import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packagePath = resolve(process.argv[2] ?? `release/t3-code-ultralight-browser-fork-${version}.tgz`);
const fixture = await mkdtemp(resolve(tmpdir(), "t3-ultralight-types-"));

try {
  const install = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", packagePath], {
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
import { createIntegrationRecipe } from "t3-code-ultralight-browser-fork/integration";

const client = createCodexClient();
const canvas = createCodexSession({ client, cwd: "/workspace" });

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
void [installCommand, clientModule];

const hostedRecipe = createIntegrationRecipe(contract, { mode: "custom", delivery: "hosted", port: 4174 });
const hostedInstall: false = hostedRecipe.requiresPackageInstall;
const hostedClient: string = hostedRecipe.hostedModules.client;
void [hostedInstall, hostedClient];

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

  console.log(JSON.stringify({ packagePath, packageImport: true, knownEventsTyped: true, unknownEventsCompatible: true, integrationRecipesTyped: true }, null, 2));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
