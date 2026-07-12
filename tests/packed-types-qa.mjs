import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packagePath = resolve(process.argv[2] ?? "release/t3-code-ultralight-browser-fork-0.30.0.tgz");
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

  console.log(JSON.stringify({ packagePath, packageImport: true, knownEventsTyped: true, unknownEventsCompatible: true }, null, 2));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
