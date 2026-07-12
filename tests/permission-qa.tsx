import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingRequestPanel } from "../src/components/PendingRequestPanel";

const defaultCss = readdirSync(resolve("dist/assets")).find((file) => file.endsWith(".css"));
const cssPath = process.env.QA_CSS_PATH ?? (defaultCss ? resolve("dist/assets", defaultCss) : null);
if (!cssPath) throw new Error("Built application CSS was not found");

const markup = renderToStaticMarkup(
  <PendingRequestPanel
    request={{
      id: "permission-qa",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-qa",
        cwd: "/Users/example/project",
        reason: "Download a dependency and update generated output",
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/Users/example/project/input"],
            write: ["/Users/example/project/output"],
            entries: [{ path: { type: "glob_pattern", pattern: "/tmp/*.json" }, access: "read" }],
          },
        },
      },
    }}
    onRespond={() => undefined}
    onReject={() => undefined}
  />,
);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const consoleErrors: string[] = [];
  page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setContent(`<main class="app-shell embedded"><section class="workspace" style="display:flex;align-items:end;padding-top:24px">${markup}</section></main>`);
  await page.addStyleTag({ path: cssPath });
  await page.locator(".permission-panel").waitFor();
  const buttons = await page.locator(".permission-panel button").allTextContents();
  await page.screenshot({ path: "/tmp/codex-web-permission-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-permission-mobile.png", fullPage: true });
  const state = {
    buttons,
    detailCount: await page.locator(".permission-list li").count(),
    checkboxCount: await page.locator('.permission-panel input[type="checkbox"]').count(),
    overflow,
    consoleErrors,
  };
  console.log(JSON.stringify(state, null, 2));
  if (buttons.join("|") !== "Decline|Allow for this turn|Allow for session" || state.detailCount !== 4 || state.checkboxCount !== 1 || overflow || consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
