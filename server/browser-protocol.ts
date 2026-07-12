export type BrowserBridgeMessage =
  | { type: "rpc"; id: string | number; method: string; params?: unknown }
  | { type: "respond"; id: string | number; result: unknown }
  | { type: "respondError"; id: string | number; error?: string };

export function parseBrowserBridgeMessage(raw: string): BrowserBridgeMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid browser bridge JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid browser bridge message");
  const message = value as Record<string, unknown>;
  if (!isRpcId(message.id)) throw new Error("Browser bridge messages require a string or numeric id");

  if (message.type === "rpc") {
    if (typeof message.method !== "string" || !message.method.trim()) throw new Error("RPC messages require a method");
    return { type: "rpc", id: message.id, method: message.method, ...(Object.hasOwn(message, "params") ? { params: message.params } : {}) };
  }
  if (message.type === "respond") {
    if (!Object.hasOwn(message, "result")) throw new Error("Response messages require a result");
    return { type: "respond", id: message.id, result: message.result };
  }
  if (message.type === "respondError") {
    if (message.error !== undefined && typeof message.error !== "string") throw new Error("Error responses require a string error");
    return { type: "respondError", id: message.id, ...(message.error === undefined ? {} : { error: message.error }) };
  }
  throw new Error("Unknown browser bridge message type");
}

function isRpcId(value: unknown): value is string | number {
  return (typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isFinite(value));
}
