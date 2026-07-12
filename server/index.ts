import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachCodexBridge, DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_PENDING_REQUESTS_PER_CLIENT } from "./attach.js";
import { readAllowedOrigins } from "./origins.js";
import { PACKAGE_VERSION } from "./version.js";

const SERVICE_NAME = "t3-code-ultralight-browser-fork";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
let bridgeReady = false;
const allowedOrigins = readAllowedOrigins(process.env.CODEX_ALLOWED_ORIGINS);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api/status") {
    return json(response, {
      service: SERVICE_NAME,
      status: bridgeReady ? "ready" : "starting",
      pid: process.pid,
      cwd: process.env.HOME ?? process.cwd(),
      version: PACKAGE_VERSION,
      websocketPath: "/ws",
      allowedOrigins,
      transport: {
        maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
        maxPendingRequestsPerClient: DEFAULT_MAX_PENDING_REQUESTS_PER_CLIENT,
      },
    });
  }

  if (process.env.NODE_ENV === "production" && existsSync(dist)) {
    return serveStatic(url.pathname, response);
  }

  response.writeHead(404).end("Not found");
});

const controller = attachCodexBridge(server, { path: "/ws", autoStart: false, allowedOrigins });
controller.bridge.on("ready", () => { bridgeReady = true; });
controller.bridge.on("exit", () => { bridgeReady = false; });

const port = readPort(process.env.PORT);
await listen(port);
try {
  await controller.start();
  bridgeReady = true;
} catch (error) {
  await controller.stop().catch(() => undefined);
  await closeServer();
  throw error;
}
console.log(`Codex bridge listening at http://127.0.0.1:${port}`);
if (allowedOrigins.length) console.log(`Additional browser origins: ${allowedOrigins.join(", ")}`);

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
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
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

function readPort(value: string | undefined) {
  const input = value ?? "4174";
  if (!/^\d+$/.test(input)) throw new Error(`Invalid bridge port ${JSON.stringify(input)}; expected an integer from 1 to 65535`);
  const port = Number(input);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid bridge port ${JSON.stringify(input)}; expected an integer from 1 to 65535`);
  }
  return port;
}

function listen(port: number) {
  return new Promise<void>((resolveListen, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error.code === "EADDRINUSE"
        ? new Error(`Port ${port} is already in use by a different service. Run \`t3-code-ultralight status --port ${port}\` to inspect it or choose another --port.`)
        : error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function closeServer() {
  return new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
