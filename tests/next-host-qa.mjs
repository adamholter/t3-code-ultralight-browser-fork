import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createCodexClient } from "../dist-lib/client.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bridgeOrigin = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:4174").origin;
const workingDirectory = await mkdtemp(resolve(tmpdir(), "t3-next-host-"));
const packagePath = process.env.QA_PACKAGE
  ? resolve(process.env.QA_PACKAGE)
  : await packWorkspace(resolve(workingDirectory, "pack"));
const fixture = resolve(workingDirectory, "host");
const nextVersion = "16.2.10";
const reactVersion = "19.2.0";
const marker = `NEXT_APP_ROUTER_${Date.now()}`;
const cleanupClient = createCodexClient({ bridgeUrl: bridgeOrigin, reconnectMs: false });
await cleanupClient.connect();
let browser;
let server;
let createdThreadId;

try {
  await createFixture();
  const build = spawnSync(process.execPath, [resolve(fixture, "node_modules/next/dist/bin/next"), "build"], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 180_000,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(build.stderr || build.stdout || "Next.js production build failed");
  assert.match(build.stdout, /Compiled successfully|Creating an optimized production build/);

  const port = await reservePort();
  server = spawn(process.execPath, [
    resolve(fixture, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port),
  ], {
    cwd: fixture,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  await waitForHttp(origin, server, () => serverOutput);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__codexThreadIds = [];
    window.addEventListener("message", (event) => {
      const value = event.data;
      if (value?.source === "t3-code-ultralight" && value.event === "thread" && typeof value.threadId === "string") {
        window.__codexThreadIds.push(value.threadId);
      }
    });
  });
  const frame = page.frameLocator("iframe");
  await frame.getByLabel("Message Codex").waitFor({ timeout: 30_000 });
  await frame.getByLabel("Message Codex").fill(`Reply with exactly: ${marker}`);
  await frame.getByLabel("Send").click();
  await frame.locator(".assistant-message").getByText(marker, { exact: false }).waitFor({ timeout: 120_000 });
  await frame.locator(".working").waitFor({ state: "detached", timeout: 120_000 });
  await page.waitForFunction(() => window.__codexThreadIds.length > 0, null, { timeout: 30_000 });
  createdThreadId = await page.evaluate(() => window.__codexThreadIds.at(-1));
  assert.equal(await page.locator("iframe").count(), 1);

  await page.screenshot({ path: "/tmp/codex-web-next-16-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const hostOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const frameOverflow = await frame.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-next-16-mobile.png", fullPage: true });
  assert.equal(hostOverflow, false);
  assert.equal(frameOverflow, false);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    packagePath,
    next: nextVersion,
    react: reactVersion,
    appRouterServerComponentImport: true,
    packageClientDirective: true,
    productionBuild: true,
    streamed: true,
    response: marker,
    iframeCount: 1,
    hostOverflow,
    frameOverflow,
    consoleErrors,
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  if (server) {
    server.kill("SIGTERM");
    if (server.exitCode === null) {
      await Promise.race([once(server, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    }
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (createdThreadId) await cleanupClient.request("thread/delete", { threadId: createdThreadId }).catch(() => undefined);
  cleanupClient.close();
  await rm(workingDirectory, { recursive: true, force: true });
}

async function createFixture() {
  await mkdir(resolve(fixture, "app"), { recursive: true });
  await writeFile(resolve(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  const installed = spawnSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact",
    packagePath, `next@${nextVersion}`, `react@${reactVersion}`, `react-dom@${reactVersion}`,
  ], { cwd: fixture, encoding: "utf8" });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
  await writeFile(resolve(fixture, "next.config.mjs"), "export default { reactStrictMode: true };");
  await writeFile(resolve(fixture, "app/layout.jsx"), `
import "./style.css";
export const metadata = { title: "Next Codex host" };
export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
`);
  // Intentionally a Server Component. The package export itself must declare
  // the client boundary for its hook-using implementation.
  await writeFile(resolve(fixture, "app/page.jsx"), `
import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";
export default function Page() {
  return <main>
    <header><strong>Next.js ${nextVersion} App Router</strong><span>Direct package import from a Server Component</span></header>
    <section><CodexChatEmbed bridgeUrl=${JSON.stringify(bridgeOrigin)} style={{ height: "100%", minHeight: 0 }} /></section>
  </main>;
}
`);
  await writeFile(resolve(fixture, "app/style.css"), `
* { box-sizing: border-box; }
html, body { min-width: 0; min-height: 100%; margin: 0; }
body { background: #eef0f3; color: #202124; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
main { display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(100%, 1040px); height: 100dvh; min-width: 0; margin: auto; padding: 12px; gap: 8px; }
header { display: flex; min-width: 0; align-items: center; gap: 10px; }
header span { color: #6f737a; font-size: 12px; }
section { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #d4d6da; border-radius: 11px; background: white; }
section > iframe { display: block; min-width: 0; min-height: 0; }
@media (max-width: 520px) { main { padding: 6px; } header { justify-content: space-between; } }
`);
}

async function packWorkspace(directory) {
  await mkdir(directory, { recursive: true });
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", directory], { cwd: root, encoding: "utf8" });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const tarballs = (await readdir(directory)).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  return resolve(directory, tarballs[0]);
}

async function waitForHttp(origin, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js host exited early.\n${output()}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Next.js host did not start.\n${output()}`);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
