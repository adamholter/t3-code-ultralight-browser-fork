import { createServer } from "node:http";
import { chromium } from "playwright";
import { once } from "node:events";

const bridgeOrigin = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:4174").origin;
const bridgeSocketOrigin = bridgeOrigin.replace(/^http/, "ws");
const useDefaultClientUrl = process.env.QA_USE_DEFAULT_CLIENT_URL === "1";
let hostOrigin = "";

const host = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(`
      import { createCodexClient } from ${JSON.stringify(`${bridgeOrigin}/codex-client.js`)};
      import { createCodexAssistant } from ${JSON.stringify(`${bridgeOrigin}/codex-assistant.js`)};
      import { handleCodexServerRequest } from ${JSON.stringify(`${bridgeOrigin}/codex-requests.js`)};
      import { createCodexEmbedController } from ${JSON.stringify(`${bridgeOrigin}/codex-embed.js`)};
      const chat = document.querySelector("codex-chat");
      window.__embedReady = false;
      window.__controllerAvailable = typeof createCodexEmbedController === "function";
      chat.addEventListener("codex-chat-ready", () => { window.__embedReady = true; });
      window.__assistantAvailable = typeof createCodexAssistant === "function";
      const assistant = createCodexAssistant({
        ${useDefaultClientUrl ? "" : `url: ${JSON.stringify(`${bridgeSocketOrigin}/ws`)},`}
        reconnectMs: false,
        requiredCapabilities: ["hostedModules", "threadIsolation"],
      });
      void createCodexClient;
      const adapterResponses = [];
      const adapterProof = handleCodexServerRequest({
        respond: (id, result) => adapterResponses.push({ id, result }),
        respondError: () => {},
      }, { id: "approval", method: "item/commandExecution/requestApproval", params: {} });
      window.__headless = Promise.all([assistant.client.connect().then(() => assistant.client.listModels()), adapterProof])
        .then(([models]) => ({
          modelCount: models.data.length,
          protocol: assistant.client.bridgeInfo.protocol,
          capabilities: assistant.client.bridgeInfo.capabilities,
          safeDefaultDecision: adapterResponses[0].result.decision,
        }))
        .finally(() => assistant.close());
    `);
    return;
  }
  response.writeHead(200, {
    "content-security-policy": `default-src 'none'; script-src 'self' ${bridgeOrigin}; frame-src ${bridgeOrigin}; connect-src ${bridgeSocketOrigin}; style-src 'unsafe-inline'`,
    "content-type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html>
    <meta charset="utf-8">
    <title>No-bundler Codex host</title>
    <script type="module" src="/app.js"></script>
    <script type="module" src="${bridgeOrigin}/codex-chat.js"></script>
    <codex-chat bridge-url="${bridgeOrigin}" title="No-bundler Codex" min-height="560px"></codex-chat>
  `);
});

host.listen(0, "127.0.0.1");
await once(host, "listening");
hostOrigin = `http://127.0.0.1:${host.address().port}`;

const denied = await fetch(`${bridgeOrigin}/codex-client.js`, { headers: { origin: "https://untrusted.example" } });
if (denied.status !== 403) throw new Error(`Expected untrusted browser module request to return 403, received ${denied.status}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
const consoleErrors = [];
const pageErrors = [];
const moduleResponses = new Map();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("response", (response) => {
  if ([`${bridgeOrigin}/codex-chat.js`, `${bridgeOrigin}/codex-embed.js`, `${bridgeOrigin}/codex-client.js`, `${bridgeOrigin}/codex-assistant.js`, `${bridgeOrigin}/codex-requests.js`].includes(response.url())) {
    moduleResponses.set(response.url(), response);
  }
});

try {
  await page.goto(hostOrigin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__embedReady === true, null, { timeout: 20_000 });
  const headless = await page.evaluate(() => window.__headless);
  await page.frameLocator("codex-chat iframe").getByLabel("Message Codex").waitFor({ timeout: 20_000 });
  const iframe = page.locator("codex-chat iframe");
  const iframeCount = await iframe.count();
  await page.screenshot({ path: "/tmp/codex-web-no-bundler-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const hostOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const frame = await (await iframe.elementHandle()).contentFrame();
  const frameOverflow = await frame.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-no-bundler-mobile.png", fullPage: true });
  const chatResponse = moduleResponses.get(`${bridgeOrigin}/codex-chat.js`);
  const embedResponse = moduleResponses.get(`${bridgeOrigin}/codex-embed.js`);
  const clientResponse = moduleResponses.get(`${bridgeOrigin}/codex-client.js`);
  const assistantResponse = moduleResponses.get(`${bridgeOrigin}/codex-assistant.js`);
  const requestsResponse = moduleResponses.get(`${bridgeOrigin}/codex-requests.js`);
  const headersValid = [chatResponse, embedResponse, clientResponse, assistantResponse, requestsResponse].every((response) =>
    response?.status() === 200
    && response.headers()["access-control-allow-origin"] === hostOrigin
    && response.headers()["cache-control"] === "no-store"
    && response.headers()["x-content-type-options"] === "nosniff"
  );
  const result = {
    customElement: await page.evaluate(() => !!customElements.get("codex-chat")),
    controllerAvailable: await page.evaluate(() => window.__controllerAvailable),
    assistantAvailable: await page.evaluate(() => window.__assistantAvailable),
    iframeCount,
    embedReady: true,
    headless,
    moduleCount: moduleResponses.size,
    headersValid,
    deniedStatus: denied.status,
    hostOverflow,
    frameOverflow,
    consoleErrors,
    pageErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    !result.customElement || !result.controllerAvailable || !result.assistantAvailable || iframeCount !== 1 || headless.modelCount < 1
    || headless.protocol.major !== 1 || !headless.capabilities.includes("hostedModules") || headless.safeDefaultDecision !== "decline"
    || moduleResponses.size !== 5 || !headersValid || hostOverflow || frameOverflow || consoleErrors.length || pageErrors.length
  ) throw new Error("No-bundler browser QA assertions failed");
} finally {
  await browser.close();
  await new Promise((resolve) => host.close(resolve));
}
