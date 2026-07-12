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
const workingDirectory = await mkdtemp(resolve(tmpdir(), "t3-react-host-"));
const packagePath = process.env.QA_PACKAGE
  ? resolve(process.env.QA_PACKAGE)
  : await packWorkspace(resolve(workingDirectory, "pack"));
const matrix = [
  { react: "18.3.1", label: "react-18" },
  { react: "19.2.0", label: "react-19" },
];
const browser = await chromium.launch({ headless: true });
const cleanupClient = createCodexClient({ bridgeUrl: bridgeOrigin, reconnectMs: false });
await cleanupClient.connect();
const createdThreadIds = new Set();
const results = [];

try {
  for (const entry of matrix) results.push(await verifyReactHost(entry));
  console.log(JSON.stringify({ packagePath, results }, null, 2));
} finally {
  for (const threadId of createdThreadIds) await cleanupClient.request("thread/delete", { threadId }).catch(() => undefined);
  cleanupClient.close();
  await browser.close();
  await rm(workingDirectory, { recursive: true, force: true });
}

async function verifyReactHost({ react, label }) {
  const fixture = resolve(workingDirectory, label);
  await rm(fixture, { recursive: true, force: true });
  await mkdir(fixture, { recursive: true });
  await writeFile(resolve(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  const installed = spawnSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact",
    packagePath, `react@${react}`, `react-dom@${react}`, "vite@7.3.6",
  ], { cwd: fixture, encoding: "utf8" });
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);

  await writeFile(resolve(fixture, "ssr.mjs"), `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";
    const html = renderToStaticMarkup(React.createElement(CodexChatEmbed, { bridgeUrl: ${JSON.stringify(bridgeOrigin)} }));
    if (!html.includes("<iframe") || !html.includes("embed=1")) throw new Error("React embed did not render during SSR");
    process.stdout.write(html);
  `);
  const ssr = spawnSync(process.execPath, ["ssr.mjs"], { cwd: fixture, encoding: "utf8" });
  if (ssr.status !== 0) throw new Error(ssr.stderr || ssr.stdout);
  assert.ok(ssr.stdout.includes("<iframe"));
  await writeFile(resolve(fixture, "hydrate.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root">${ssr.stdout}</div><script type="module" src="/hydrate.jsx"></script></body></html>`);
  await writeFile(resolve(fixture, "hydrate.jsx"), `
    import React from "react";
    import { hydrateRoot } from "react-dom/client";
    import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";
    window.__hydrated = false;
    hydrateRoot(document.getElementById("root"), <CodexChatEmbed
      bridgeUrl=${JSON.stringify(bridgeOrigin)}
      onCodexReady={() => { window.__hydrated = true; }}
    />);
  `);

  const marker = `REACT_HOST_${react.replaceAll(".", "_")}_${Date.now()}`;
  await writeFile(resolve(fixture, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>React Codex host</title></head><body><div id="root"></div><script type="module" src="/src.jsx"></script></body></html>');
  await writeFile(resolve(fixture, "src.jsx"), reactHostSource({ bridgeOrigin, marker }));
  await writeFile(resolve(fixture, "style.css"), `
    * { box-sizing: border-box; }
    html, body, #root { min-width: 0; min-height: 100%; margin: 0; }
    body { background: #eef0f3; color: #202124; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
    main { display: grid; grid-template-rows: auto auto minmax(0, 1fr); width: min(100%, 1040px); height: 100dvh; min-width: 0; margin: auto; padding: 12px; gap: 8px; }
    header, nav { display: flex; min-width: 0; align-items: center; gap: 10px; }
    header span { color: #6f737a; font-size: 12px; }
    nav { flex-wrap: wrap; }
    button { border: 1px solid #d4d6da; border-radius: 7px; padding: 7px 10px; background: white; color: inherit; cursor: pointer; }
    button:disabled { cursor: default; opacity: .45; }
    .chat-shell { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #d4d6da; border-radius: 11px; background: white; }
    .chat-shell > iframe { display: block; min-width: 0; min-height: 100% !important; border-radius: inherit !important; }
    @media (max-width: 520px) { main { padding: 6px; } header { justify-content: space-between; } nav { gap: 6px; } button { padding: 6px 8px; } }
  `);

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
    await waitForHttp(origin, server, () => serverOutput);
    const hydrationPage = await browser.newPage({ viewport: { width: 900, height: 720 } });
    const hydrationErrors = [];
    hydrationPage.on("console", (message) => { if (message.type() === "error") hydrationErrors.push(message.text()); });
    hydrationPage.on("pageerror", (error) => hydrationErrors.push(error.message));
    try {
      await hydrationPage.goto(`${origin}/hydrate.html`, { waitUntil: "domcontentloaded" });
      await hydrationPage.waitForFunction(() => window.__hydrated === true, null, { timeout: 30_000 });
      assert.equal(await hydrationPage.locator("iframe").count(), 1);
      assert.deepEqual(hydrationErrors, []);
    } finally {
      await hydrationPage.close();
    }

    const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const ask = page.getByRole("button", { name: "Ask Codex" });
      await ask.waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => window.__reactHost.readyCount > 0, null, { timeout: 30_000 });
      await ask.click();
      await page.frameLocator("iframe").locator(".assistant-message").getByText(marker, { exact: false }).waitFor({ timeout: 120_000 });
      await page.frameLocator("iframe").locator(".working").waitFor({ state: "detached", timeout: 120_000 });
      await page.waitForFunction(() => window.__reactHost.turns.includes("completed") && window.__reactHost.acks.length === 1, null, { timeout: 30_000 });

      const beforeRemount = await page.evaluate(() => ({
        version: window.__reactHost.reactVersion,
        readyCount: window.__reactHost.readyCount,
        connections: [...window.__reactHost.connections],
        turns: [...window.__reactHost.turns],
        acks: [...window.__reactHost.acks],
      }));
      assert.equal(beforeRemount.version, react);
      assert.ok(beforeRemount.readyCount >= 1);
      assert.ok(beforeRemount.connections.includes("ready"));
      assert.ok(beforeRemount.turns.includes("started"));
      assert.ok(beforeRemount.turns.includes("completed"));
      assert.equal(typeof beforeRemount.acks[0].threadId, "string");
      assert.equal(typeof beforeRemount.acks[0].turnId, "string");
      createdThreadIds.add(beforeRemount.acks[0].threadId);

      await page.screenshot({ path: `/tmp/codex-web-${label}-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const hostOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const frameOverflow = await page.frameLocator("iframe").locator("html").evaluate((element) => element.scrollWidth > element.clientWidth);
      await page.screenshot({ path: `/tmp/codex-web-${label}-mobile.png`, fullPage: true });
      assert.equal(hostOverflow, false);
      assert.equal(frameOverflow, false);
      await page.setViewportSize({ width: 1100, height: 820 });

      await page.getByRole("button", { name: "Unmount chat" }).click();
      await page.locator("iframe").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Remount chat" }).click();
      await page.locator("iframe").waitFor();
      await page.waitForFunction((count) => window.__reactHost.readyCount > count, beforeRemount.readyCount, { timeout: 30_000 });
      await page.getByRole("button", { name: "New thread" }).click();
      await page.waitForFunction(() => window.__reactHost.newThreadOk === true, null, { timeout: 30_000 });
      await page.getByRole("button", { name: "Stop" }).click();
      await page.waitForFunction(() => window.__reactHost.stopOk === true, null, { timeout: 30_000 });
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);

      return {
        react,
        ssrRendered: true,
        hydrated: true,
        strictMode: true,
        streamed: true,
        controllerRef: ["sendPrompt", "newThread", "stop"],
        eventCallbacks: { ready: beforeRemount.readyCount, connections: beforeRemount.connections, turns: beforeRemount.turns },
        remounted: true,
        hostOverflow,
        frameOverflow,
        consoleErrors,
        pageErrors,
      };
    } finally {
      const threadIds = await page.evaluate(() => window.__reactHost?.acks?.map((entry) => entry.threadId) ?? []).catch(() => []);
      for (const threadId of threadIds) if (typeof threadId === "string") createdThreadIds.add(threadId);
      await page.close();
    }
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode === null) await Promise.race([once(server, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}

function reactHostSource({ bridgeOrigin, marker }) {
  return `
import React, { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";
import "./style.css";

window.__reactHost = {
  reactVersion: React.version,
  readyCount: 0,
  connections: [],
  turns: [],
  acks: [],
  newThreadOk: false,
  stopOk: false,
};

function App() {
  const codex = useRef(null);
  const [mounted, setMounted] = useState(true);
  const [, refresh] = useState(0);
  const update = () => refresh((value) => value + 1);
  const ask = async () => {
    const result = await codex.current.sendPrompt(${JSON.stringify(`Reply with exactly: ${marker}`)}, { newThread: true });
    window.__reactHost.acks.push(result);
    update();
  };
  const newThread = async () => {
    window.__reactHost.newThreadOk = (await codex.current.newThread()).ok;
    update();
  };
  const stop = async () => {
    window.__reactHost.stopOk = (await codex.current.stop()).ok;
    update();
  };
  return <main>
    <header><strong>React {React.version} host</strong><span>Local Codex embed</span></header>
    <nav aria-label="Host controls">
      <button onClick={ask} disabled={!mounted || window.__reactHost.readyCount === 0}>Ask Codex</button>
      <button onClick={newThread} disabled={!mounted}>New thread</button>
      <button onClick={stop} disabled={!mounted}>Stop</button>
      <button onClick={() => setMounted((value) => !value)}>{mounted ? "Unmount chat" : "Remount chat"}</button>
    </nav>
    <section className="chat-shell">
      {mounted ? <CodexChatEmbed
        controllerRef={codex}
        bridgeUrl=${JSON.stringify(bridgeOrigin)}
        onCodexReady={() => { window.__reactHost.readyCount += 1; update(); }}
        onConnectionChange={(event) => { window.__reactHost.connections.push(event.status); update(); }}
        onTurnChange={(event) => { window.__reactHost.turns.push(event.phase); update(); }}
        onCodexError={(event) => { throw new Error(event.message); }}
      /> : <p>Chat unmounted</p>}
    </section>
  </main>;
}

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
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

async function waitForHttp(origin, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`React host server exited early.\n${output()}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`React host server did not start.\n${output()}`);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
