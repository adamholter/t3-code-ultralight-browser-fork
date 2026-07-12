const WEB_PROTOCOLS = new Set(["http:", "https:"]);

/** Normalize explicit browser origins once at bridge startup. */
export function normalizeAllowedOrigins(origins: string[] = []) {
  return [...new Set(origins.map(normalizeOrigin))];
}

/**
 * Browser sockets are same-machine by default. Additional origins must be
 * explicitly listed; a wildcard is intentionally unsupported.
 */
export function isAllowedOrigin(origin: string | undefined, additional: string[] = []) {
  // Node, native, and CLI WebSocket clients commonly omit Origin.
  if (!origin) return true;
  if (additional.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return WEB_PROTOCOLS.has(url.protocol)
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function readAllowedOrigins(value: string | undefined) {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("CODEX_ALLOWED_ORIGINS must be a JSON array of exact browser origins.");
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("CODEX_ALLOWED_ORIGINS must be a JSON array of exact browser origins.");
  }
  return normalizeAllowedOrigins(parsed);
}

function normalizeOrigin(value: string) {
  const input = value.trim();
  // Browsers use the literal Origin value `null` for file:// and sandboxed documents.
  if (input === "null") return input;
  if (!input || input === "*" || input.includes(",")) {
    throw new Error(`Invalid allowed origin: ${JSON.stringify(value)}. Use an exact http:// or https:// origin; wildcards are not supported.`);
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid allowed origin: ${JSON.stringify(value)}. Include the scheme, for example https://app.example.com.`);
  }
  if (!WEB_PROTOCOLS.has(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Invalid allowed origin: ${JSON.stringify(value)}. Use only scheme, host, and optional port.`);
  }
  return url.origin;
}
