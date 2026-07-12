import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachCodexBridge } from "./attach.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
let bridgeReady = false;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api/status") {
    return json(response, {
      status: bridgeReady ? "ready" : "starting",
      cwd: process.env.HOME ?? process.cwd(),
      version: "0.2.0",
    });
  }

  if (process.env.NODE_ENV === "production" && existsSync(dist)) {
    return serveStatic(url.pathname, response);
  }

  response.writeHead(404).end("Not found");
});

const controller = attachCodexBridge(server, { path: "/ws", autoStart: false });
controller.bridge.on("ready", () => { bridgeReady = true; });
controller.bridge.on("exit", () => { bridgeReady = false; });

await controller.start();
bridgeReady = true;
const port = Number(process.env.PORT ?? 4174);
server.listen(port, "127.0.0.1", () => {
  console.log(`Codex bridge listening at http://127.0.0.1:${port}`);
});

async function serveStatic(pathname: string, response: ServerResponse) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(dist, requested);
  const safePath = candidate.startsWith(`${dist}/`) ? candidate : resolve(dist, "index.html");
  const filePath = await isFile(safePath) ? safePath : resolve(dist, "index.html");
  response.writeHead(200, { "content-type": contentType(filePath) });
  createReadStream(filePath).pipe(response);
}

async function isFile(path: string) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function contentType(path: string) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  } as Record<string, string>)[extname(path)] ?? "application/octet-stream";
}

function shutdown() {
  void controller.stop().finally(() => server.close(() => process.exit(0)));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
