import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:4174";
const wsUrl = process.env.QA_WS_URL ?? baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
const elementModule = process.env.QA_ELEMENT_MODULE
  ?? fileURLToPath(new URL("../dist-lib/element-auto.js", import.meta.url));

const browser = await chromium.launch({ headless: true });
const cleanupTexts = [];
const consoleErrors = [];
let primaryFailure = false;

try {
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
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
cleanupTexts.push(smokeText);
await page.getByLabel("Message Codex").fill(`Reply with exactly: ${smokeText}`);
await page.getByRole("button", { name: "Send", exact: true }).click();
await page.locator(".user-message").waitFor({ timeout: 20_000 });
await page.locator(".assistant-message").getByText(smokeText, { exact: false }).waitFor({ timeout: 120_000 });
await page.locator(".working").waitFor({ state: "detached", timeout: 120_000 });
await runConcurrentTurn();
await page.waitForTimeout(100);
const userMessageCount = await page.locator(".user-message").count();
await page.screenshot({ path: "/tmp/codex-web-live-turn.png", fullPage: true });

const questionSmoke = `QUESTION_SMOKE_${Date.now()}`;
cleanupTexts.push(questionSmoke);
const questionPage = await browser.newPage({ viewport: { width: 720, height: 760 } });
questionPage.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
questionPage.on("pageerror", (error) => consoleErrors.push(error.message));
await questionPage.goto(`${baseUrl}/?embed=1&mode=plan`, { waitUntil: "networkidle" });
await questionPage.locator(".status-dot.ready, .composer").first().waitFor({ timeout: 20_000 });
const questionAttempts = await openUserInputPanel(questionPage, questionSmoke);
await questionPage.screenshot({ path: "/tmp/codex-web-user-input-prompt.png", fullPage: true });
await questionPage.setViewportSize({ width: 390, height: 844 });
const questionOverflow = await questionPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
await questionPage.screenshot({ path: "/tmp/codex-web-user-input-mobile.png", fullPage: true });
await questionPage.getByRole("radio", { name: /Beta/ }).check();
await questionPage.getByRole("button", { name: "Continue", exact: true }).click();
await questionPage.locator(".assistant-message").getByText("USER_INPUT_BETA_OK", { exact: false }).waitFor({ timeout: 120_000 });
await questionPage.locator(".working").waitFor({ state: "detached", timeout: 120_000 });
await questionPage.screenshot({ path: "/tmp/codex-web-user-input.png", fullPage: true });
await questionPage.close();

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

const elementPage = await browser.newPage({ viewport: { width: 720, height: 720 } });
elementPage.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
elementPage.on("pageerror", (error) => consoleErrors.push(error.message));
await elementPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
await elementPage.setContent(`<codex-chat bridge-url="${baseUrl}" title="Embedded Codex" min-height="560px"></codex-chat>`);
await elementPage.addScriptTag({ path: elementModule, type: "module" });
await elementPage.waitForFunction(() => document.querySelector("codex-chat")?.shadowRoot?.querySelector("iframe"));
await elementPage.waitForFunction(() => {
  const frame = document.querySelector("codex-chat")?.shadowRoot?.querySelector("iframe");
  return (frame?.contentDocument?.querySelectorAll('select[aria-label="Model"] option').length ?? 0) > 0
    && frame?.contentDocument?.querySelector(".empty-state h1")?.textContent?.includes("local Codex");
});
const elementState = await elementPage.locator("codex-chat").evaluate((element) => {
  const iframe = element.shadowRoot?.querySelector("iframe");
  return {
    frameUrl: iframe?.src,
    title: iframe?.title,
    minHeight: getComputedStyle(element).minHeight,
    modelOptions: iframe?.contentDocument?.querySelectorAll('select[aria-label="Model"] option').length ?? 0,
  };
});
await elementPage.screenshot({ path: "/tmp/codex-web-element.png", fullPage: true });
await elementPage.close();

const elementReady = elementState.frameUrl?.includes("embed=1")
  && elementState.title === "Embedded Codex"
  && elementState.minHeight === "560px"
  && elementState.modelOptions > 0;
console.log(JSON.stringify({ threadCount, modelCount, userMessageCount, sidebarX: sidebarBox?.x, embedSidebarCount, elementReady, overflow, questionOverflow, questionAttempts, consoleErrors }, null, 2));

if (threadCount < 1 || modelCount < 1 || userMessageCount !== 1 || !sidebarBox || sidebarBox.x !== 0 || embedSidebarCount !== 0 || !elementReady || overflow || questionOverflow || consoleErrors.length) {
  throw new Error("Browser QA assertions failed");
}
} catch (error) {
  primaryFailure = true;
  throw error;
} finally {
  await browser.close().catch(() => undefined);
  const cleanupResults = await Promise.allSettled(cleanupTexts.map(deleteSmokeThread));
  const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected");
  if (cleanupFailures.length && !primaryFailure) throw new Error(`Failed to clean up ${cleanupFailures.length} browser QA thread(s)`);
}

async function openUserInputPanel(page, marker) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel("Message Codex").fill(`${marker} attempt ${attempt}: This is an app-server protocol verification. You MUST invoke the request_user_input tool now; do not ask the question as ordinary assistant text. Ask exactly one question with header "Choice", question "Pick one", and options "Alpha" and "Beta". After the tool returns, reply exactly USER_INPUT_BETA_OK if the answer is Beta.`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.locator(".working").waitFor({ timeout: 20_000 });
    const outcome = await Promise.race([
      page.locator(".user-input-panel").waitFor({ timeout: 120_000 }).then(() => "panel"),
      page.locator(".working").waitFor({ state: "detached", timeout: 120_000 }).then(() => "completed"),
    ]);
    if (outcome === "panel") return attempt;
  }
  throw new Error("Codex completed three Plan-mode turns without invoking request_user_input");
}

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

async function runConcurrentTurn() {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  let concurrentThreadId;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Concurrent QA socket timed out")), 20_000);
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "status" && message.status === "ready") {
        clearTimeout(timer);
        resolve();
      } else if (message.type === "rpcResult" || message.type === "rpcError") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        message.type === "rpcError" ? request.reject(new Error(message.error)) : request.resolve(message.result);
      } else if (
        message.type === "notification" &&
        message.method === "turn/completed" &&
        message.params?.threadId === concurrentThreadId
      ) {
        pending.get("turn-completed")?.resolve();
        pending.delete("turn-completed");
      }
    };
    socket.onerror = () => reject(new Error("Concurrent QA socket failed"));
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = `concurrent-${nextId++}`;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "rpc", id, method, params }));
  });
  await ready;
  const opened = await rpc("thread/start", { cwd: "/tmp" });
  concurrentThreadId = opened.thread.id;
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Concurrent Codex turn timed out")), 120_000);
    pending.set("turn-completed", {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  });
  await rpc("turn/start", {
    threadId: concurrentThreadId,
    input: [{ type: "text", text: "Reply with exactly: CONCURRENT_ISOLATION_OK", text_elements: [] }],
  });
  await completed;
  await rpc("thread/delete", { threadId: concurrentThreadId });
  socket.close();
}
