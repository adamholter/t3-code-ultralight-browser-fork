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
  const indexResponse = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".status-dot.ready").waitFor({ timeout: maxReadyMs });
  const contractResponse = await page.request.get(`${baseUrl}/api/integration`);
  const integrationContract = await contractResponse.json();
  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource");
    const assets = resources.filter((entry) => /\.(?:js|css)(?:\?|$)/.test(entry.name));
    return {
      readyMs: Math.round(performance.now()),
      assetBytes: assets.reduce((total, entry) => total + entry.decodedBodySize, 0),
      assetCount: assets.length,
      assetUrls: assets.map((entry) => entry.name),
      fontRequests: resources.filter((entry) => entry.initiatorType === "css" && /\.(?:woff2?|ttf|otf)(?:\?|$)/.test(entry.name)).length,
    };
  });
  const assetResponses = await Promise.all(metrics.assetUrls.map((url) => page.request.get(url)));
  const statusResponse = await page.request.get(`${baseUrl}/api/status`);
  const statusBody = await statusResponse.json();
  const staleAsset = await page.request.get(`${baseUrl}/assets/removed-release-asset.js`);
  const indexHeaders = indexResponse?.headers() ?? {};
  const httpSurface = {
    indexNoStore: indexHeaders["cache-control"] === "no-store",
    embedAllowed: !indexHeaders["x-frame-options"] && indexHeaders["content-security-policy"]?.includes("frame-ancestors *"),
    csp: indexHeaders["content-security-policy"]?.includes("script-src 'self'") && indexHeaders["content-security-policy"]?.includes("object-src 'none'"),
    noReferrer: indexHeaders["referrer-policy"] === "no-referrer",
    nosniff: indexHeaders["x-content-type-options"] === "nosniff",
    hashedAssetsImmutable: assetResponses.every((response) => response.headers()["cache-control"] === "public, max-age=31536000, immutable"),
    hashedAssetsNosniff: assetResponses.every((response) => response.headers()["x-content-type-options"] === "nosniff"),
    staleAssetStatus: staleAsset.status(),
    statusNoStore: statusResponse.headers()["cache-control"] === "no-store",
    statusHidesLocalPath: !("cwd" in statusBody) && !JSON.stringify(statusBody).includes(process.env.HOME ?? "__missing_home__"),
  };
  const { assetUrls: _assetUrls, ...publicMetrics } = metrics;
  const result = {
    ...publicMetrics,
    maxAssetBytes,
    maxReadyMs,
    integrationContract: {
      available: contractResponse.ok(),
      schemaVersion: integrationContract.schemaVersion,
      version: integrationContract.version,
      modes: Object.keys(integrationContract.modes ?? {}),
      noStore: contractResponse.headers()["cache-control"] === "no-store",
    },
    httpSurface,
    consoleErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    metrics.assetBytes > maxAssetBytes
    || metrics.assetCount !== 2
    || metrics.fontRequests !== 0
    || metrics.readyMs > maxReadyMs
    || !result.integrationContract.available
    || result.integrationContract.schemaVersion !== 1
    || result.integrationContract.modes.join(",") !== "completeChat,customUi,attachedServer"
    || !result.integrationContract.noStore
    || Object.entries(httpSurface).some(([key, value]) => key !== "staleAssetStatus" && value !== true)
    || httpSurface.staleAssetStatus !== 404
    || consoleErrors.length
  ) throw new Error("Standalone performance QA assertions failed");
} finally {
  await browser.close();
}
