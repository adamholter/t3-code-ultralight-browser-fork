export interface EmbedUrlOptions {
  /** Same-origin WebSocket pathname used by path-mounted or token-scoped bridges. */
  websocketPath?: string;
  /** Same-origin status pathname used to load the iframe host-origin policy. */
  statusPath?: string;
}

/** Add embed configuration without forcing an absolute URL (safe for SSR and relative paths). */
export function buildEmbedUrl(url: string, options: EmbedUrlOptions = {}) {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "");
  params.set("embed", "1");
  if (options.websocketPath) params.set("codex-ws-path", validateSameOriginPath(options.websocketPath, "websocketPath"));
  if (options.statusPath) params.set("codex-status-path", validateSameOriginPath(options.statusPath, "statusPath"));
  return `${pathname}?${params.toString()}${hash}`;
}

function validateSameOriginPath(value: string, name: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error(`${name} must be an absolute same-origin pathname`);
  }
  const parsed = new URL(value, "http://codex.invalid");
  if (parsed.origin !== "http://codex.invalid" || parsed.hash) {
    throw new Error(`${name} must be an absolute same-origin pathname without a fragment`);
  }
  return `${parsed.pathname}${parsed.search}`;
}
