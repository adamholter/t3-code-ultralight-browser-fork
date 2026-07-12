import { createRequire } from "node:module";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:4174";
const wsUrl = process.env.QA_WS_URL ?? baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.locator(".status-dot.ready").waitFor({ timeout: 20_000 });
await page.locator(".thread-row").first().waitFor({ timeout: 20_000 });
const threadCount = await page.locator(".thread-row").count();
const modelCount = await page.locator('select[aria-label="Model"] option').count();
await page.screenshot({ path: "/tmp/codex-web-desktop.png", fullPage: true });

await page.getByRole("button", { name: "New thread" }).click();
const smokeText = `CODEX_WEB_SMOKE_${Date.now()}`;
await page.getByLabel("Message Codex").fill(`Reply with exactly: ${smokeText}`);
await page.getByRole("button", { name: "Send", exact: true }).click();
await page.locator(".user-message").waitFor({ timeout: 20_000 });
await page.locator(".assistant-message").getByText(smokeText, { exact: false }).waitFor({ timeout: 120_000 });
await page.locator(".working").waitFor({ state: "detached", timeout: 120_000 });
const userMessageCount = await page.locator(".user-message").count();
await page.screenshot({ path: "/tmp/codex-web-live-turn.png", fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Open sidebar" }).click();
await page.locator(".sidebar-open").waitFor();
await page.waitForTimeout(250);
const sidebarBox = await page.locator(".sidebar-open").boundingBox();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await page.screenshot({ path: "/tmp/codex-web-mobile.png", fullPage: true });

const embed = await browser.newPage({ viewport: { width: 720, height: 720 } });
await embed.goto(`${baseUrl}/?embed=1`, { waitUntil: "networkidle" });
await embed.locator(".status-dot.ready, .composer").first().waitFor({ timeout: 20_000 });
const embedSidebarCount = await embed.locator(".sidebar").count();
await embed.screenshot({ path: "/tmp/codex-web-embed.png", fullPage: true });
await embed.close();

console.log(JSON.stringify({ threadCount, modelCount, userMessageCount, sidebarX: sidebarBox?.x, embedSidebarCount, overflow, consoleErrors }, null, 2));
await browser.close();
await deleteSmokeThread(smokeText);

if (threadCount < 1 || modelCount < 1 || userMessageCount !== 1 || !sidebarBox || sidebarBox.x !== 0 || embedSidebarCount !== 0 || overflow || consoleErrors.length) process.exit(1);

async function deleteSmokeThread(text) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pendingDeletes = new Set();
    const timer = setTimeout(() => reject(new Error("Smoke thread cleanup timed out")), 15_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "status" && message.status === "ready") {
        socket.send(JSON.stringify({ type: "rpc", id: "qa-list", method: "thread/list", params: { limit: 20, sortKey: "recency_at", sortDirection: "desc" } }));
      } else if (message.id === "qa-list") {
        const matches = (message.result?.data ?? []).filter((thread) => thread.preview?.includes(text));
        if (!matches.length) finish();
        for (const thread of matches) {
          const id = `qa-delete-${thread.id}`;
          pendingDeletes.add(id);
          socket.send(JSON.stringify({ type: "rpc", id, method: "thread/delete", params: { threadId: thread.id } }));
        }
      } else if (pendingDeletes.delete(message.id) && pendingDeletes.size === 0) {
        finish();
      }
    };
    socket.onerror = () => reject(new Error("Smoke thread cleanup socket failed"));
    function finish() { clearTimeout(timer); socket.close(); resolve(); }
  });
}
