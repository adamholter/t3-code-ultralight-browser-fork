import { createRequire } from "node:module";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:4174";
const maxAssetBytes = Number(process.env.QA_MAX_ASSET_BYTES ?? 260_000);
const maxReadyMs = Number(process.env.QA_MAX_READY_MS ?? 5_000);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".status-dot.ready").waitFor({ timeout: maxReadyMs });
  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource");
    const assets = resources.filter((entry) => /\.(?:js|css)(?:\?|$)/.test(entry.name));
    return {
      readyMs: Math.round(performance.now()),
      assetBytes: assets.reduce((total, entry) => total + entry.decodedBodySize, 0),
      assetCount: assets.length,
      fontRequests: resources.filter((entry) => entry.initiatorType === "css" && /\.(?:woff2?|ttf|otf)(?:\?|$)/.test(entry.name)).length,
    };
  });
  const result = { ...metrics, maxAssetBytes, maxReadyMs, consoleErrors };
  console.log(JSON.stringify(result, null, 2));
  if (
    metrics.assetBytes > maxAssetBytes
    || metrics.assetCount !== 2
    || metrics.fontRequests !== 0
    || metrics.readyMs > maxReadyMs
    || consoleErrors.length
  ) throw new Error("Standalone performance QA assertions failed");
} finally {
  await browser.close();
}
