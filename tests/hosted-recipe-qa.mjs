import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const integrationModule = process.env.QA_INTEGRATION_MODULE
  ? pathToFileURL(process.env.QA_INTEGRATION_MODULE).href
  : new URL("../dist-lib/integration.js", import.meta.url).href;
const { createIntegrationRecipe } = await import(integrationModule);
const contract = JSON.parse(await readFile(new URL("../integration.json", import.meta.url), "utf8"));
const bridgeOrigin = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:4174").origin;
const bridgePort = Number(new URL(bridgeOrigin).port || 80);
const bridgeSocketOrigin = bridgeOrigin.replace(/^http/, "ws");
const marker = `HOSTED_RECIPE_${Date.now()}`;
const recipe = createIntegrationRecipe(contract, {
  mode: "custom",
  delivery: "hosted",
  port: bridgePort,
  cwd: "/tmp",
});

assert.equal(recipe.requiresPackageInstall, false);
assert.equal(recipe.codeLanguage, "js");
assert.deepEqual(recipe.csp, {
  "script-src": [bridgeOrigin],
  "connect-src": [bridgeSocketOrigin],
});

const host = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(`
      let streamedText = "";
      const yourUI = {
        reviewApproval: async () => false,
        ask: async () => ({}),
        renderStreamingText: (text) => { streamedText = text; },
      };
      const prompt = ${JSON.stringify(`Reply with exactly: ${marker}`)};
      ${recipe.code}
      window.__hostedRecipeResult = {
        text: answer.text.trim(),
        streamed: streamedText.includes(${JSON.stringify(marker)}),
        threadId: answer.threadId,
      };
      detachRequests();
      await codex.close();
    `);
    return;
  }
  response.writeHead(200, {
    "content-security-policy": `default-src 'none'; script-src 'self' ${bridgeOrigin}; connect-src ${bridgeSocketOrigin};`,
    "content-type": "text/html; charset=utf-8",
  });
  response.end('<!doctype html><meta charset="utf-8"><title>Hosted recipe QA</title><script type="module" src="/app.js"></script>');
});

host.listen(0, "127.0.0.1");
await once(host, "listening");
const hostOrigin = `http://127.0.0.1:${host.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(hostOrigin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hostedRecipeResult, null, { timeout: 30_000 });
  const result = await page.evaluate(() => window.__hostedRecipeResult);
  assert.equal(result.text, marker);
  assert.equal(result.streamed, true);
  assert.equal(typeof result.threadId, "string");
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({
    delivery: recipe.delivery,
    packageInstall: recipe.requiresPackageInstall,
    clientModule: recipe.hostedModules.client,
    requestModule: recipe.hostedModules.requests,
    response: result.text,
    streamed: result.streamed,
    disposed: true,
    consoleErrors,
    pageErrors,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => host.close(resolve));
}
