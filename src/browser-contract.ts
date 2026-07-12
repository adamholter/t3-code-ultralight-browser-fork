export const CODEX_BROWSER_PROTOCOL = { major: 1, minor: 1 } as const;

export const CODEX_BROWSER_CAPABILITIES = [
  "rpc",
  "serverRequests",
  "requestOwnership",
  "threadIsolation",
  "transportLimits",
  "hostedModules",
] as const;

export type CodexBrowserCapability = (typeof CODEX_BROWSER_CAPABILITIES)[number];

export interface CodexBridgeInfo {
  protocol: { major: number; minor: number };
  bridgeVersion: string | null;
  capabilities: string[];
  limits: { maxPayloadBytes: number; maxPendingRequestsPerClient: number } | null;
  legacy: boolean;
}

export function createCodexBridgeHello(options: {
  bridgeVersion: string;
  maxPayloadBytes: number;
  maxPendingRequestsPerClient: number;
}) {
  return {
    type: "hello" as const,
    protocol: CODEX_BROWSER_PROTOCOL,
    bridgeVersion: options.bridgeVersion,
    capabilities: [...CODEX_BROWSER_CAPABILITIES],
    limits: {
      maxPayloadBytes: options.maxPayloadBytes,
      maxPendingRequestsPerClient: options.maxPendingRequestsPerClient,
    },
  };
}

export function parseCodexBridgeHello(value: unknown): CodexBridgeInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const hello = value as Record<string, unknown>;
  if (hello.type !== "hello" || !isRecord(hello.protocol)) return null;
  const { major, minor } = hello.protocol;
  if (!Number.isSafeInteger(major) || Number(major) < 0 || !Number.isSafeInteger(minor) || Number(minor) < 0) return null;
  if (typeof hello.bridgeVersion !== "string" || !hello.bridgeVersion) return null;
  if (!Array.isArray(hello.capabilities) || !hello.capabilities.every((entry) => typeof entry === "string" && entry.length > 0)) return null;
  if (!isRecord(hello.limits)) return null;
  const { maxPayloadBytes, maxPendingRequestsPerClient } = hello.limits;
  if (!positiveSafeInteger(maxPayloadBytes) || !positiveSafeInteger(maxPendingRequestsPerClient)) return null;
  return {
    protocol: { major: Number(major), minor: Number(minor) },
    bridgeVersion: hello.bridgeVersion,
    capabilities: [...hello.capabilities],
    limits: {
      maxPayloadBytes: Number(maxPayloadBytes),
      maxPendingRequestsPerClient: Number(maxPendingRequestsPerClient),
    },
    legacy: false,
  };
}

export function legacyCodexBridgeInfo(): CodexBridgeInfo {
  return {
    protocol: { major: 0, minor: 0 },
    bridgeVersion: null,
    capabilities: [],
    limits: null,
    legacy: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
