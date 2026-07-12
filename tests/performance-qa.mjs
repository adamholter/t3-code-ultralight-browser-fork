import { chromium } from "playwright";
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:4174";
const baseOrigin = new URL(baseUrl).origin;
const maxAssetBytes = Number(process.env.QA_MAX_ASSET_BYTES ?? 110_000);
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
    opaqueFramingRequiresOptIn: !indexHeaders["content-security-policy"]?.includes("frame-ancestors * file:"),
    csp: indexHeaders["content-security-policy"]?.includes("script-src 'self'") && indexHeaders["content-security-policy"]?.includes("object-src 'none'"),
    noReferrer: indexHeaders["referrer-policy"] === "no-referrer",
    nosniff: indexHeaders["x-content-type-options"] === "nosniff",
    hashedAssetsImmutable: assetResponses.every((response) => response.headers()["cache-control"] === "public, max-age=31536000, immutable"),
    hashedAssetsNosniff: assetResponses.every((response) => response.headers()["x-content-type-options"] === "nosniff"),
    staleAssetStatus: staleAsset.status(),
    statusNoStore: statusResponse.headers()["cache-control"] === "no-store",
    statusHidesLocalPath: !("cwd" in statusBody) && !JSON.stringify(statusBody).includes(process.env.HOME ?? "__missing_home__"),
    workspaceFingerprintOnly: /^[a-f0-9]{64}$/.test(statusBody.workspaceFingerprint) && !("workspaceCwd" in statusBody),
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
      budgetMatches: integrationContract.performance?.browserAppBudgetBytes === maxAssetBytes,
      markdownRuntimeDependencies: integrationContract.performance?.externalMarkdownRuntimeDependencies,
      runtimeAware: integrationContract.runtime?.live === true
        && integrationContract.runtime.origin === baseOrigin
        && integrationContract.bridge?.httpUrl === baseOrigin
        && integrationContract.bridge?.websocketUrl === baseOrigin.replace(/^http/, "ws") + "/ws"
        && integrationContract.modes?.completeChat?.iframeUrl === `${baseOrigin}/?embed=1`
        && integrationContract.modes?.completeChat?.controllerModule === `${baseOrigin}/codex-embed.js`
        && integrationContract.modes?.customUi?.browserModule === `${baseOrigin}/codex-client.js`,
      workspacePortable: integrationContract.runtime?.workspace?.default === "bridge"
        && integrationContract.runtime?.workspace?.pathDisclosed === false,
      pathFreeSetupRecipes: integrationContract.security?.pathFreeSetupRecipes === true,
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
    || !result.integrationContract.budgetMatches
    || result.integrationContract.markdownRuntimeDependencies !== 0
    || !result.integrationContract.runtimeAware
    || !result.integrationContract.workspacePortable
    || !result.integrationContract.pathFreeSetupRecipes
    || Object.entries(httpSurface).some(([key, value]) => key !== "staleAssetStatus" && value !== true)
    || httpSurface.staleAssetStatus !== 404
    || consoleErrors.length
  ) throw new Error("Standalone performance QA assertions failed");
} finally {
  await browser.close();
}
