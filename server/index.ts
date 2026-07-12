import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachCodexBridge,
  CODEX_BROWSER_CAPABILITIES,
  CODEX_BROWSER_PROTOCOL,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_PENDING_REQUESTS_PER_CLIENT,
} from "./attach.js";
import { isAllowedOrigin, readAllowedOrigins } from "./origins.js";
import { materializeRuntimeIntegrationContract } from "./integration-contract.js";
import { PACKAGE_VERSION } from "./version.js";

const SERVICE_NAME = "t3-code-ultralight-browser-fork";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const libraryDist = resolve(root, "dist-lib");
const browserModules = {
  "/codex-chat.js": resolve(libraryDist, "element-auto.js"),
  "/codex-client.js": resolve(libraryDist, "client.js"),
  "/codex-requests.js": resolve(libraryDist, "requests.js"),
} as const;
const integrationContract = resolve(root, "integration.json");
let bridgeReady = false;
const allowedOrigins = readAllowedOrigins(process.env.CODEX_ALLOWED_ORIGINS);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api/status") {
    return json(response, {
      service: SERVICE_NAME,
      status: bridgeReady ? "ready" : "starting",
      pid: process.pid,
      version: PACKAGE_VERSION,
      websocketPath: "/ws",
      protocol: CODEX_BROWSER_PROTOCOL,
      capabilities: CODEX_BROWSER_CAPABILITIES,
      browserModules: Object.keys(browserModules),
      allowedOrigins,
      transport: {
        maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
        maxPendingRequestsPerClient: DEFAULT_MAX_PENDING_REQUESTS_PER_CLIENT,
      },
    });
  }
  if (url.pathname === "/api/integration" || url.pathname === "/integration.json") {
    return serveIntegrationContract(response, port);
  }

  const browserModule = browserModules[url.pathname as keyof typeof browserModules];
  if (browserModule) return serveBrowserModule(browserModule, request.headers.origin, response);

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

async function serveBrowserModule(filePath: string, origin: string | undefined, response: ServerResponse) {
  if (!isAllowedOrigin(origin, allowedOrigins)) {
    response.writeHead(403, {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    }).end("Browser origin is not allowed");
    return;
  }
  if (!(await isFile(filePath))) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Browser module is not built");
    return;
  }
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-type": "text/javascript; charset=utf-8",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
}

async function serveIntegrationContract(response: ServerResponse, port: number) {
  if (!(await isFile(integrationContract))) {
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "Integration contract is not packaged" }));
    return;
  }
  try {
    const packaged = JSON.parse(await readFile(integrationContract, "utf8"));
    json(response, materializeRuntimeIntegrationContract(packaged, { port }));
  } catch (cause) {
    response.writeHead(500, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    }).end(JSON.stringify({ error: cause instanceof Error ? cause.message : "Integration contract is invalid" }));
  }
}
console.log(`Codex bridge listening at http://127.0.0.1:${port}`);
if (allowedOrigins.length) console.log(`Additional browser origins: ${allowedOrigins.join(", ")}`);

async function serveStatic(pathname: string, response: ServerResponse) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(dist, requested);
  const safePath = candidate.startsWith(`${dist}/`) ? candidate : resolve(dist, "index.html");
  const exists = await isFile(safePath);
  if (!exists && extname(requested)) {
    response.writeHead(404, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    }).end("Static asset not found");
    return;
  }
  const filePath = exists ? safePath : resolve(dist, "index.html");
  const isHashedAsset = /^assets\/.+-[A-Za-z0-9_-]+\.(?:js|css)$/.test(requested);
  response.writeHead(200, {
    "cache-control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-store",
    "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors *; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'none'",
    "content-type": contentType(filePath),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
}

async function isFile(path: string) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
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
