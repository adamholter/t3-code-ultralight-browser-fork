import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const releaseDirectory = resolve("release");
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const output = execFileSync("npm", ["pack", "--pack-destination", releaseDirectory], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const filename = output.trim().split(/\r?\n/).at(-1);
if (!filename?.endsWith(".tgz")) throw new Error("npm pack did not return a tarball filename");
const versionedPath = resolve(releaseDirectory, filename);
const stableFilename = "t3-code-ultralight-browser-fork.tgz";
await copyFile(versionedPath, resolve(releaseDirectory, stableFilename));
const bytes = await readFile(versionedPath);
const { size } = await stat(versionedPath);
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

console.log(JSON.stringify({ filename, stableFilename, size, integrity }, null, 2));
