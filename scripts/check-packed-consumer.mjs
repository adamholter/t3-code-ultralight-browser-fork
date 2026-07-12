import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = process.cwd();
const outputDirectory = await mkdtemp(resolve(tmpdir(), "t3-ultralight-pack-"));

try {
  const pack = runNpm(["pack", "--ignore-scripts", "--pack-destination", outputDirectory], {
    cwd: root,
    encoding: "utf8",
  });
  if (pack.status !== 0) throw new Error(pack.stderr || pack.stdout);
  const tarballs = (await readdir(outputDirectory)).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) throw new Error(`Expected one packed tarball, found ${tarballs.length}`);

  const packagePath = resolve(outputDirectory, tarballs[0]);
  const consumer = spawnSync(process.execPath, [resolve(root, "tests/packed-types-qa.mjs"), packagePath], {
    cwd: root,
    encoding: "utf8",
  });
  if (consumer.status !== 0) throw new Error(consumer.stderr || consumer.stdout);
  process.stdout.write(consumer.stdout);
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

function runNpm(args, options) {
  const npmCli = process.env.npm_execpath;
  return npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], options)
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { ...options, shell: process.platform === "win32" });
}
