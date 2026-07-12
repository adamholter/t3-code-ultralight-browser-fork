import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/Markdown";

const require = createRequire("/Users/adam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json");
const { chromium } = require("playwright");
const css = readdirSync(resolve("dist/assets")).find((file) => file.endsWith(".css"));
if (!css) throw new Error("Built application CSS was not found");

const fixture = `# Implementation result

The local bridge is **ready**, the response is *streaming*, and ~~old setup~~ is no longer required. See [the integration guide](https://example.com/docs).

> Keep Codex credentials in the local process. The browser receives protocol events only.

- [x] Connected to the local app-server
- [x] Streamed assistant text
- [ ] Render the selected canvas nodes
  - Nested task context remains aligned

| Surface | Delivery | State |
| :--- | :---: | ---: |
| React | package | ready |
| Voice canvas | hosted | ready |

\`\`\`ts
const codex = createCodexSession({ cwd: "/workspace" });
const result = await codex.send("Explain this selection", {
  onDelta: (_delta, text) => render(text),
});
\`\`\`

Inline code such as \`session.stop()\` remains compact.  
This line intentionally follows a hard break.

<script>window.__unsafe = true</script>`;
const markup = renderToStaticMarkup(<Markdown>{fixture}</Markdown>);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const consoleErrors: string[] = [];
  page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error: Error) => consoleErrors.push(error.message));
  await page.setContent(`<main class="app-shell embedded"><section class="workspace"><div class="conversation"><div class="timeline"><article class="message assistant-message"><div class="message-mark">C</div><div class="markdown">${markup}</div></article></div></div></section></main>`);
  await page.addStyleTag({ path: resolve("dist/assets", css) });
  await page.locator(".markdown h1").waitFor();
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const desktop = {
    headings: await page.locator(".markdown h1").count(),
    taskItems: await page.locator(".markdown .task-item").count(),
    tableRows: await page.locator(".markdown table tr").count(),
    codeBlocks: await page.locator(".markdown .code-block").count(),
    copyButtons: await page.getByRole("button", { name: "Copy code" }).count(),
    safeLinks: await page.locator('.markdown a[rel="noreferrer noopener"]').count(),
    scripts: await page.locator(".markdown script").count(),
    unsafeTextVisible: await page.getByText('<script>window.__unsafe = true</script>', { exact: true }).count(),
  };
  await page.screenshot({ path: "/tmp/codex-web-markdown-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: "/tmp/codex-web-markdown-mobile.png", fullPage: true });

  const result = { ...desktop, desktopOverflow, mobileOverflow, consoleErrors };
  console.log(JSON.stringify(result, null, 2));
  if (
    desktop.headings !== 1 || desktop.taskItems !== 3 || desktop.tableRows !== 3
    || desktop.codeBlocks !== 1 || desktop.copyButtons !== 1 || desktop.safeLinks !== 1
    || desktop.scripts !== 0 || desktop.unsafeTextVisible !== 1
    || desktopOverflow || mobileOverflow || consoleErrors.length
  ) process.exitCode = 1;
} finally {
  await browser.close();
}
