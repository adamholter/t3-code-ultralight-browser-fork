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
const workingDirectory = await mkdtemp(resolve(tmpdir(), "t3-framework-host-"));
const packagePath = process.env.QA_PACKAGE
  ? resolve(process.env.QA_PACKAGE)
  : await packWorkspace(resolve(workingDirectory, "pack"));
const matrix = [
  { framework: "Vue", version: "3.5.39", label: "vue-3", create: createVueFixture },
  { framework: "Svelte", version: "5.56.4", label: "svelte-5", create: createSvelteFixture },
];
const browser = await chromium.launch({ headless: true });
const cleanupClient = createCodexClient({ bridgeUrl: bridgeOrigin, reconnectMs: false });
await cleanupClient.connect();
const createdThreadIds = new Set();
const results = [];

try {
  for (const entry of matrix) results.push(await verifyFrameworkHost(entry));
  console.log(JSON.stringify({ packagePath, results }, null, 2));
} finally {
  for (const threadId of createdThreadIds) {
    await cleanupClient.request("thread/delete", { threadId }).catch(() => undefined);
  }
  cleanupClient.close();
  await browser.close();
  await rm(workingDirectory, { recursive: true, force: true });
}

async function verifyFrameworkHost(entry) {
  const fixture = resolve(workingDirectory, entry.label);
  const marker = `${entry.label.toUpperCase().replaceAll("-", "_")}_${Date.now()}`;
  await rm(fixture, { recursive: true, force: true });
  await mkdir(fixture, { recursive: true });
  await writeFile(resolve(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  await entry.create({ fixture, marker, version: entry.version });
  await writeFile(resolve(fixture, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Framework Codex host</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>');
  await writeFile(resolve(fixture, "src/style.css"), hostStyles());

  const port = await reservePort();
  const viteBin = resolve(fixture, "node_modules/vite/bin/vite.js");
  const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: fixture,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  const origin = `http://127.0.0.1:${port}`;

  try {
    await waitForHttp(origin, server, () => serverOutput, entry.framework);
    const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Ask Codex" }).waitFor({ timeout: 30_000 });
      assert.equal(await page.evaluate(() => Boolean(customElements.get("codex-chat"))), true);
      await page.frameLocator("codex-chat iframe").locator(".assistant-message").getByText(marker, { exact: false }).waitFor({ timeout: 120_000 });
      await page.frameLocator("codex-chat iframe").locator(".working").waitFor({ state: "detached", timeout: 120_000 });
      await page.waitForFunction(() => window.__frameworkHost.turns.includes("completed") && window.__frameworkHost.acks.length === 1, null, { timeout: 30_000 });

      const beforeRemount = await page.evaluate(() => structuredClone(window.__frameworkHost));
      assert.equal(beforeRemount.framework, entry.framework);
      assert.equal(beforeRemount.version, entry.version);
      assert.equal(beforeRemount.preReadySendStarted, true);
      assert.equal(beforeRemount.preReadySendCompleted, true);
      assert.ok(beforeRemount.readyCount >= 1);
      assert.equal(beforeRemount.loadCount, 1);
      assert.equal(await page.locator("codex-chat iframe").count(), 1);
      assert.ok(beforeRemount.connections.includes("ready"));
      assert.ok(beforeRemount.turns.includes("started"));
      assert.ok(beforeRemount.turns.includes("completed"));
      assert.equal(typeof beforeRemount.acks[0].threadId, "string");
      assert.equal(typeof beforeRemount.acks[0].turnId, "string");
      createdThreadIds.add(beforeRemount.acks[0].threadId);

      await page.screenshot({ path: `/tmp/codex-web-${entry.label}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const hostOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const frameOverflow = await page.frameLocator("codex-chat iframe").locator("html").evaluate((element) => element.scrollWidth > element.clientWidth);
      await page.screenshot({ path: `/tmp/codex-web-${entry.label}-mobile.png`, fullPage: true });
      assert.equal(hostOverflow, false);
      assert.equal(frameOverflow, false);
      await page.setViewportSize({ width: 1100, height: 820 });

      await page.getByRole("button", { name: "Unmount chat" }).click();
      await page.locator("codex-chat iframe").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Remount chat" }).click();
      await page.locator("codex-chat iframe").waitFor();
      await page.waitForFunction((count) => window.__frameworkHost.readyCount > count, beforeRemount.readyCount, { timeout: 30_000 });
      await page.getByRole("button", { name: "New thread" }).click();
      await page.waitForFunction(() => window.__frameworkHost.newThreadOk === true, null, { timeout: 30_000 });
      await page.getByRole("button", { name: "Stop" }).click();
      await page.waitForFunction(() => window.__frameworkHost.stopOk === true, null, { timeout: 30_000 });
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);

      return {
        framework: entry.framework,
        version: entry.version,
        packageElement: true,
        streamed: true,
        preReadySend: true,
        controller: ["sendPrompt", "newThread", "stop"],
        eventLifecycle: { loads: beforeRemount.loadCount, ready: beforeRemount.readyCount, connections: beforeRemount.connections, turns: beforeRemount.turns },
        remounted: true,
        hostOverflow,
        frameOverflow,
        consoleErrors,
        pageErrors,
      };
    } finally {
      const threadIds = await page.evaluate(() => window.__frameworkHost?.acks?.map((entry) => entry.threadId) ?? []).catch(() => []);
      for (const threadId of threadIds) if (typeof threadId === "string") createdThreadIds.add(threadId);
      await page.close();
    }
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode === null) {
      await Promise.race([once(server, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    }
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}

async function createVueFixture({ fixture, marker, version }) {
  install(fixture, packagePath, `vue@${version}`, "vite@7.3.6");
  await mkdir(resolve(fixture, "src"), { recursive: true });
  await writeFile(resolve(fixture, "src/main.js"), `
import { createApp, h, onBeforeUnmount, onMounted, ref } from "vue";
import "t3-code-ultralight-browser-fork/element/auto";
import "./style.css";

const state = window.__frameworkHost = {
  framework: "Vue", version: ${JSON.stringify(version)}, loadCount: 0, readyCount: 0,
  connections: [], turns: [], acks: [], preReadySendStarted: false, preReadySendCompleted: false,
  newThreadOk: false, stopOk: false,
};

createApp({
  setup() {
    const chat = ref(null);
    const mounted = ref(true);
    const readyCount = ref(0);
    const handlers = {
      load: () => { state.loadCount += 1; },
      ready: () => { state.readyCount += 1; readyCount.value += 1; },
      connection: (event) => { state.connections.push(event.detail.status); },
      turn: (event) => { state.turns.push(event.detail.phase); },
    };
    onMounted(() => {
      document.addEventListener("codex-chat-load", handlers.load);
      document.addEventListener("codex-chat-ready", handlers.ready);
      document.addEventListener("codex-chat-connection", handlers.connection);
      document.addEventListener("codex-chat-turn", handlers.turn);
      state.preReadySendStarted = true;
      void ask().then(() => { state.preReadySendCompleted = true; }).catch((error) => queueMicrotask(() => { throw error; }));
    });
    onBeforeUnmount(() => {
      document.removeEventListener("codex-chat-load", handlers.load);
      document.removeEventListener("codex-chat-ready", handlers.ready);
      document.removeEventListener("codex-chat-connection", handlers.connection);
      document.removeEventListener("codex-chat-turn", handlers.turn);
    });
    const ask = async () => { state.acks.push(await chat.value.sendPrompt(${JSON.stringify(`Reply with exactly: ${marker}`)}, { newThread: true })); };
    const newThread = async () => { state.newThreadOk = (await chat.value.newThread()).ok; };
    const stop = async () => { state.stopOk = (await chat.value.stop()).ok; };
    return () => h("main", [
      h("header", [h("strong", "Vue ${version} host"), h("span", "Package Web Component")]),
      h("nav", { "aria-label": "Host controls" }, [
        h("button", { onClick: ask, disabled: !mounted.value || readyCount.value === 0 }, "Ask Codex"),
        h("button", { onClick: newThread, disabled: !mounted.value }, "New thread"),
        h("button", { onClick: stop, disabled: !mounted.value }, "Stop"),
        h("button", { onClick: () => { mounted.value = !mounted.value; } }, mounted.value ? "Unmount chat" : "Remount chat"),
      ]),
      h("section", { class: "chat-shell" }, mounted.value
        ? [h("codex-chat", { ref: chat, "bridge-url": ${JSON.stringify(bridgeOrigin)}, "min-height": "0px" })]
        : [h("p", "Chat unmounted")]),
    ]);
  },
}).mount("#app");
`);
}

async function createSvelteFixture({ fixture, marker, version }) {
  install(fixture, packagePath, `svelte@${version}`, "@sveltejs/vite-plugin-svelte@6.2.4", "vite@7.3.6");
  await mkdir(resolve(fixture, "src"), { recursive: true });
  await writeFile(resolve(fixture, "vite.config.js"), 'import { defineConfig } from "vite"; import { svelte } from "@sveltejs/vite-plugin-svelte"; export default defineConfig({ plugins: [svelte()] });');
  await writeFile(resolve(fixture, "src/main.js"), 'import { mount } from "svelte"; import App from "./App.svelte"; import "./style.css"; mount(App, { target: document.getElementById("app") });');
  await writeFile(resolve(fixture, "src/App.svelte"), `
<script>
  import { onMount } from "svelte";
  import "t3-code-ultralight-browser-fork/element/auto";
  let chat;
  let mounted = true;
  let readyCount = 0;
  const state = window.__frameworkHost = {
    framework: "Svelte", version: ${JSON.stringify(version)}, loadCount: 0, readyCount: 0,
    connections: [], turns: [], acks: [], preReadySendStarted: false, preReadySendCompleted: false,
    newThreadOk: false, stopOk: false,
  };
  onMount(() => {
    const load = () => { state.loadCount += 1; };
    const ready = () => { state.readyCount += 1; readyCount += 1; };
    const connection = (event) => { state.connections.push(event.detail.status); };
    const turn = (event) => { state.turns.push(event.detail.phase); };
    document.addEventListener("codex-chat-load", load);
    document.addEventListener("codex-chat-ready", ready);
    document.addEventListener("codex-chat-connection", connection);
    document.addEventListener("codex-chat-turn", turn);
    state.preReadySendStarted = true;
    void ask().then(() => { state.preReadySendCompleted = true; }).catch((error) => queueMicrotask(() => { throw error; }));
    return () => {
      document.removeEventListener("codex-chat-load", load);
      document.removeEventListener("codex-chat-ready", ready);
      document.removeEventListener("codex-chat-connection", connection);
      document.removeEventListener("codex-chat-turn", turn);
    };
  });
  async function ask() { state.acks.push(await chat.sendPrompt(${JSON.stringify(`Reply with exactly: ${marker}`)}, { newThread: true })); }
  async function newThread() { state.newThreadOk = (await chat.newThread()).ok; }
  async function stop() { state.stopOk = (await chat.stop()).ok; }
</script>

<main>
  <header><strong>Svelte ${version} host</strong><span>Package Web Component</span></header>
  <nav aria-label="Host controls">
    <button onclick={ask} disabled={!mounted || readyCount === 0}>Ask Codex</button>
    <button onclick={newThread} disabled={!mounted}>New thread</button>
    <button onclick={stop} disabled={!mounted}>Stop</button>
    <button onclick={() => mounted = !mounted}>{mounted ? "Unmount chat" : "Remount chat"}</button>
  </nav>
  <section class="chat-shell">
    {#if mounted}
      <codex-chat bind:this={chat} bridge-url=${JSON.stringify(bridgeOrigin)} min-height="0px"></codex-chat>
    {:else}
      <p>Chat unmounted</p>
    {/if}
  </section>
</main>
`);
}

function install(fixture, ...packages) {
  const installed = spawnSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", ...packages,
  ], { cwd: fixture, encoding: "utf8" });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
}

function hostStyles() {
  return `
* { box-sizing: border-box; }
html, body, #app { min-width: 0; min-height: 100%; margin: 0; }
body { background: #eef0f3; color: #202124; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
main { display: grid; grid-template-rows: auto auto minmax(0, 1fr); width: min(100%, 1040px); height: 100dvh; min-width: 0; margin: auto; padding: 12px; gap: 8px; }
header, nav { display: flex; min-width: 0; align-items: center; gap: 10px; }
header span { color: #6f737a; font-size: 12px; }
nav { flex-wrap: wrap; }
button { border: 1px solid #d4d6da; border-radius: 7px; padding: 7px 10px; background: white; color: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .45; }
.chat-shell { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #d4d6da; border-radius: 11px; background: white; }
.chat-shell > codex-chat { display: block; min-width: 0; min-height: 0; height: 100%; border-radius: inherit; }
@media (max-width: 520px) { main { padding: 6px; } header { justify-content: space-between; } nav { gap: 6px; } button { padding: 6px 8px; } }
`;
}

async function packWorkspace(directory) {
  await mkdir(directory, { recursive: true });
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", directory], { cwd: root, encoding: "utf8" });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const tarballs = (await readdir(directory)).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);
  return resolve(directory, tarballs[0]);
}

async function waitForHttp(origin, child, output, framework) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${framework} host server exited early.\n${output()}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${framework} host server did not start.\n${output()}`);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
