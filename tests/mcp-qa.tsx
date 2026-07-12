import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingRequestPanel } from "../src/components/PendingRequestPanel";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const defaultCss = readdirSync(resolve("dist/assets")).find((file) => file.endsWith(".css"));
const cssPath = process.env.QA_CSS_PATH ?? (defaultCss ? resolve("dist/assets", defaultCss) : null);
if (!cssPath) throw new Error("Built application CSS was not found");

const render = (request: Parameters<typeof PendingRequestPanel>[0]["request"]) => renderToStaticMarkup(
  <PendingRequestPanel request={request} onRespond={() => undefined} onReject={() => undefined} />,
);
const form = render({
  id: "mcp-form-qa",
  method: "mcpServer/elicitation/request",
  params: {
    threadId: "thread-qa",
    mode: "form",
    serverName: "Issue tracker",
    message: "Add the selected canvas item as an issue",
    requestedSchema: {
      type: "object",
      required: ["title", "priority", "estimate"],
      properties: {
        title: { type: "string", title: "Issue title", description: "Keep it concise", minLength: 3 },
        priority: { type: "string", title: "Priority", oneOf: [{ const: "high", title: "High" }, { const: "low", title: "Low" }], default: "high" },
        estimate: { type: "integer", title: "Estimate", description: "Whole hours", minimum: 1, maximum: 20, default: 3 },
        notify: { type: "boolean", title: "Notify watchers", default: true },
        labels: { type: "array", title: "Labels", items: { type: "string", enum: ["bug", "feature"] }, default: ["feature"] },
      },
    },
  },
});
const url = render({
  id: "mcp-url-qa",
  method: "mcpServer/elicitation/request",
  params: { threadId: "thread-qa", mode: "url", serverName: "Calendar", message: "Connect your calendar to continue", url: "https://accounts.example.com/connect", elicitationId: "auth-qa" },
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  const consoleErrors: string[] = [];
  page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const setPanel = async (markup: string) => {
    await page.setContent(`<main class="app-shell embedded"><section class="workspace" style="display:flex;align-items:end;padding-top:24px">${markup}</section></main>`);
    await page.addStyleTag({ path: cssPath });
    await page.locator(".mcp-panel").waitFor();
  };

  await setPanel(form);
  const formControls = await page.locator(".mcp-panel input, .mcp-panel select").count();
  const continueDisabled = await page.getByRole("button", { name: "Continue" }).isDisabled();
  await page.screenshot({ path: "/tmp/codex-web-mcp-form-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const formOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-mcp-form-mobile.png", fullPage: true });

  await setPanel(url);
  const authorization = page.getByRole("link", { name: "Open accounts.example.com" });
  const safeLink = await authorization.getAttribute("rel") === "noreferrer noopener" && await authorization.getAttribute("target") === "_blank";
  const urlOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-mcp-url-mobile.png", fullPage: true });

  const state = { formControls, continueDisabled, safeLink, formOverflow, urlOverflow, consoleErrors };
  console.log(JSON.stringify(state, null, 2));
  if (formControls !== 6 || !continueDisabled || !safeLink || formOverflow || urlOverflow || consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
