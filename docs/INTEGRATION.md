# Integration guide

Choose the narrowest mode that fits the host product.

## Preflight

Run this before integration work:

```bash
npx t3-code-ultralight doctor
```

For automation or agent parsing, use `doctor --json`. The command is read-only and does not create a thread.

Use `t3-code-ultralight status --json` to inspect a standalone bridge without starting Codex. `serve` is idempotent for an identical version and allowed-origin set, making repeated agent setup safe. A conflicting version, missing requested origin, invalid port, or unrelated listener fails with an actionable message rather than silently reusing the wrong process. Use `t3-code-ultralight stop [--port PORT] [--json]` before an upgrade or origin change; it validates the service identity and reported PID, waits for shutdown, and is safe to repeat.

## Mode 0: framework-neutral Web Component

Use this for Vue, Svelte, Angular, Lit, Astro, vanilla TypeScript, or any host that supports custom elements:

Without a bundler, load the self-registering module directly from the running bridge:

```html
<script type="module" src="http://127.0.0.1:4174/codex-chat.js"></script>
<codex-chat bridge-url="http://127.0.0.1:4174"></codex-chat>
```

The endpoint is a self-contained ES module with `no-store`, `nosniff`, explicit cross-origin resource policy, and origin-scoped CORS headers. A strict CSP can allow it with `script-src http://127.0.0.1:4174` and the iframe with `frame-src http://127.0.0.1:4174`; no inline JavaScript is required.

With an ESM bundler, use the package export:

```ts
import "t3-code-ultralight-browser-fork/element/auto";
```

```html
<codex-chat bridge-url="/local-codex" min-height="560px"></codex-chat>
```

Supported attributes are `bridge-url`, `title`, `min-height`, and `loading`. Style the isolated frame through `codex-chat::part(frame)`. `codex-chat-load` reports the iframe load; `codex-chat-ready` means the local bridge and model catalog are actually ready.

```ts
const chat = document.querySelector("codex-chat");
chat.addEventListener("codex-chat-turn", (event) => {
  const { detail } = event as CustomEvent<{ phase: "started" | "completed" }>;
  hostControls.busy = detail.phase === "started";
});
```

For explicit registration or a custom tag:

```ts
import { defineCodexChatElement } from "t3-code-ultralight-browser-fork/element";
defineCodexChatElement({ tagName: "my-codex", defaultBridgeUrl: "/local-codex" });
```

## Mode 1: isolated chat embed

Use this when the product needs a complete chat surface quickly. It has no CSS or state collisions with the host.

The isolated page uses Preact internally to minimize its standalone download. The `CodexChatEmbed` wrapper below remains a normal React component and does not replace or alias React inside the host application.

```tsx
import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";

<CodexChatEmbed bridgeUrl="http://127.0.0.1:4174" />
```

Start the bridge with `npx t3-code-ultralight start`. It waits until the Codex app-server is ready, then exits while the loopback bridge continues in the background. Use `--json` for a stable receipt containing the URL, version, PID, allowed origins, and log path. Use `serve` when the host intentionally manages a foreground child process.

React hosts receive the same verified events as typed callbacks:

```tsx
<CodexChatEmbed
  onCodexReady={({ modelCount }) => setModelCount(modelCount)}
  onConnectionChange={({ status }) => setCodexStatus(status)}
  onThreadChange={({ threadId }) => saveThreadId(threadId)}
  onTurnChange={({ phase }) => setBusy(phase === "started")}
  onCodexError={({ message }) => showError(message)}
/>
```

The complete lifecycle event set is `connection`, `ready`, `thread`, `turn`, and `error`. It intentionally excludes prompt text, response text, credentials, and tool payloads.

Raw iframe hosts can use the same exact-window and exact-origin filter:

```ts
import { subscribeCodexEmbedEvents } from "t3-code-ultralight-browser-fork/embed-events";

const unsubscribe = subscribeCodexEmbedEvents(iframe, (event) => {
  if (event.event === "turn") setBusy(event.phase === "started");
});
```

## Browser origins

The bridge accepts browser connections from `localhost`, `127.0.0.1`, and `[::1]` by default. This covers normal local development regardless of port. A custom UI running on a non-loopback browser origin needs an explicit exact-origin allowlist entry:

```bash
npx t3-code-ultralight start \
  --allow-origin https://canvas.example.com \
  --allow-origin http://192.168.1.20:3000
```

Use scheme, host, and optional port only. Paths, credentials, comma-separated values, and `*` are rejected. Use `--allow-origin null` only when a trusted `file://` or sandboxed host is intentional. This changes which browser pages may connect; it never changes the server's `127.0.0.1` bind address.

The isolated chat iframe connects from its own loopback origin, so its parent page does not normally need an entry. A headless client runs in the parent page and does.

## Mode 2: headless client

Use this for canvas, voice, spatial, game, terminal, or product-specific interfaces.

No-bundler hosts can import the same self-contained API from the running bridge:

```ts
import { createCodexSession } from "http://127.0.0.1:4174/codex-client.js";
```

Request adapters are available at `http://127.0.0.1:4174/codex-requests.js`. Both module endpoints follow the WebSocket origin policy. Localhost origins work automatically; pass the exact non-loopback origin to `serve --allow-origin` when needed.

```ts
import { createCodexSession } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexSession({
  cwd: projectPath,
  model: selectedModel,
  effort: "low",
});

const result = await codex.send(prompt, {
  onDelta: (_delta, text) => renderStreamingText(text),
});
```

`send()` creates a thread automatically and remembers it for follow-ups. Follow-ups skip the redundant `thread/resume` RPC while the session stays connected; a bridge or Codex app-server reconnect invalidates that fast path and triggers one recovery resume. `stop()` interrupts the active Codex turn while keeping the session reusable, `reset()` starts a new conversation, and `await close()` performs final disposal. Disposal is idempotent, rejects future sends/resets, and waits for an active interrupt acknowledgment before closing an owned connection; a supplied shared client remains open. In synchronous framework cleanup hooks, call `void codex.close()`. For images or other rich inputs, pass an array:

```ts
await codex.send([
  { type: "image", url: imageDataUrl },
  { type: "text", text: "Explain this screenshot" },
], { cwd: projectPath });
```

Use `createCodexClient()` when several sessions share one socket or the host manages thread IDs itself. Its `chat()`, `runTurn()`, and `runInput()` methods accept the same `signal`, `onDelta`, `onEvent`, and `onTurnStarted` options.

For several independent surfaces, construct sessions with one supplied client. Each session retains its own thread and turn callbacks while the client owns the single socket:

```ts
import { createCodexClient, createCodexSession } from "t3-code-ultralight-browser-fork/client";
import { attachCodexSessionRequestHandlers } from "t3-code-ultralight-browser-fork/requests";

const client = createCodexClient();
const canvas = createCodexSession({ client, cwd: projectPath });
const voice = createCodexSession({ client, cwd: projectPath });

const offCanvasRequests = attachCodexSessionRequestHandlers(canvas, canvasHandlers);
const offVoiceRequests = attachCodexSessionRequestHandlers(voice, voiceHandlers);

await Promise.all([canvas.send(canvasPrompt), voice.send(voicePrompt)]);
await canvas.close(); // voice and client remain usable
await voice.close();
client.close();
```

The session-scoped adapter follows `session.threadId` dynamically, including after reset, and ignores sibling requests. Use one global `attachCodexRequestHandlers(client, handlers)` instead only when the host intentionally centralizes every prompt in one UI.

The headless client defaults to the standard standalone bridge at `http://127.0.0.1:4174`. Set `bridgeUrl` to another standalone HTTP(S) origin and the client derives its `/ws` endpoint safely. Set the lower-level `url` only for an attached server or another custom WebSocket path:

```ts
createCodexClient({ bridgeUrl: "http://127.0.0.1:5000" });
createCodexClient({ url: "ws://127.0.0.1:3000/codex-ws" });
```

`turnTimeoutMs` and `AbortSignal` cancellation both send `turn/interrupt` to Codex before rejecting locally, so abandoning a host-side promise does not leave an invisible turn running.

Useful lower-level client events:

| Event | Use |
| --- | --- |
| `item/agentMessage/delta` | Append streamed response text |
| `item/started` | Show a command, file edit, MCP call, or reasoning item |
| `item/completed` | Replace the item with its final status and output |
| `turn/started` | Show running state and save the turn ID |
| `turn/completed` | Resolve UI state and surface errors |
| `serverRequest` | Render approval or user-input requests |

The generic `request(method, params)` method exposes the complete app-server RPC surface without growing this SDK. `runTurn()` and `runInput()` are available when the host manages thread lifecycle itself.

Connection state is emitted through `client.on("connection", status => ...)`. Failed automatic retries are contained and emitted through `client.on("reconnectError", error => ...)`; they do not create unhandled promise rejections in the host page.

`await client.connect()` resolves only after the browser protocol handshake. Inspect `client.bridgeInfo` for the bridge version, protocol, capabilities, and active transport limits. Custom hosts that depend on a safety property can fail before their first RPC:

```ts
const client = createCodexClient({
  requiredCapabilities: ["requestOwnership", "threadIsolation"],
});
await client.connect();
console.log(client.bridgeInfo);
```

Protocol-major mismatches and missing required capabilities reject `connect()` with an actionable error. A legacy bridge that begins with the pre-handshake status envelope remains usable and reports `bridgeInfo.legacy === true`; requiring a modern capability intentionally rejects that fallback.

## Interactive questions

The complete chat renders `request_user_input` as an accessible options/free-text form. Add `mode=plan` to its bridge URL when the chat should use Codex Plan mode:

```html
<codex-chat bridge-url="http://127.0.0.1:4174/?mode=plan"></codex-chat>
```

For a single custom UI—or one intentionally centralized prompt surface—the recommended path is one typed adapter subscription:

```ts
import { attachCodexRequestHandlers } from "t3-code-ultralight-browser-fork/requests";

const detach = attachCodexRequestHandlers(codex.client, {
  approval: async (request) => await ui.confirmApproval(request) ? "accept" : "decline",
  userInput: (questions, request) => ui.askQuestions(questions, request),
  permission: (permission, request) => ui.reviewPermission(permission, request),
  mcpForm: (elicitation, defaults, request) => ui.fillMcpForm(elicitation, defaults, request),
  mcpUrl: (elicitation, request) => ui.completeMcpUrl(elicitation, request),
  onError: (error) => ui.showError(error.message),
});
```

The adapter serializes each protocol correctly, answers `currentTime/read` automatically, maps legacy approvals, and returns safe defaults when a handler is absent: approvals and MCP decline, questions skip, permissions reject, and unknown requests fail closed. Call `detach()` when the host UI unmounts. Use `handleCodexServerRequest()` for one-off dispatch without a subscription.

The lower-level helpers remain available when a host needs complete manual control:

Custom interfaces can use the framework-neutral response helpers:

```ts
import { buildUserInputResponse, getUserInputQuestions } from "t3-code-ultralight-browser-fork/requests";

codex.on("serverRequest", async (request) => {
  const questions = getUserInputQuestions(request);
  if (!questions) return;

  const values = await yourUI.ask(questions);
  codex.respond(request.id, buildUserInputResponse(values));
});
```

`values` is a record of question IDs to string arrays. Use `codex.respondError(id, message)` when the host cannot safely handle a server request.

Permission requests have a different response schema. Parse and display every requested capability, then let the user choose the grant scope:

```ts
import { buildPermissionResponse, getPermissionRequest } from "t3-code-ultralight-browser-fork/requests";

codex.on("serverRequest", async (request) => {
  const permission = getPermissionRequest(request);
  if (!permission) return;

  const choice = await yourUI.reviewPermission(permission);
  if (!choice) return codex.respondError(request.id, "Permission request declined");
  codex.respond(request.id, buildPermissionResponse(permission, choice.scope, choice.strictAutoReview));
});
```

The complete chat includes this review panel. It grants exactly the requested network and filesystem profile, defaults the primary choice to the current turn, makes session scope explicit, and can keep strict command-by-command review enabled. It also answers thread-scoped `currentTime/read` requests locally with whole Unix seconds and removes prompts resolved automatically by app-server.

MCP tools can elicit primitive typed data or ask the user to complete a URL flow. The complete chat renders supported `form` and `openai/form` object schemas with string, email, URL, date, date-time, number, integer, boolean, single-select, and multi-select controls. It enforces required/default/min/max constraints and returns typed content:

```ts
import {
  buildMcpElicitationAction,
  buildMcpElicitationResponse,
  getMcpElicitationDefaults,
  getMcpElicitationRequest,
  isMcpElicitationComplete,
} from "t3-code-ultralight-browser-fork/requests";

const elicitation = getMcpElicitationRequest(request);
if (elicitation?.mode === "url") {
  const finished = await yourUI.openAndWait(elicitation.url);
  codex.respond(request.id, buildMcpElicitationAction(finished ? "accept" : "decline"));
} else if (elicitation) {
  const values = await yourUI.fill(elicitation.fields, getMcpElicitationDefaults(elicitation));
  if (isMcpElicitationComplete(elicitation, values)) {
    codex.respond(request.id, buildMcpElicitationResponse(elicitation, values));
  }
}
```

URL mode accepts only credential-free HTTP(S) URLs and always requires an explicit user click. Nested objects, arbitrary arrays, unknown formats, contradictory constraints, and unsafe URLs are not approximated; they fail closed so the host can decline them explicitly.

## Mode 3: existing Node server

Attach to an existing `node:http` server rather than launching a second service:

```ts
import { attachCodexBridge } from "t3-code-ultralight-browser-fork/server";

const controller = attachCodexBridge(httpServer, {
  path: "/codex-ws",
  cwd: process.cwd(),
  allowedOrigins: ["https://canvas.example.com"],
  maxPayloadBytes: 16 * 1024 * 1024,
  maxPendingRequestsPerClient: 32,
});

await controller.start();
```

Call `await controller.stop()` during graceful shutdown.

Every thread-scoped notification and app-server request is delivered only to the browser that owns its thread. This includes streamed assistant text, reasoning, tool activity, turn lifecycle, and approvals. Legacy approvals are correlated through `conversationId`; modern requests use `threadId`. Unowned thread notifications are dropped, requests with no identifiable live owner are rejected back to Codex, and a response is accepted exactly once from its recorded owner. Only genuinely unscoped bridge lifecycle notifications are broadcast.

The server begins each WebSocket with a versioned `hello`, followed by the existing status envelope. Browser messages must use the documented `rpc`, `respond`, or `respondError` envelope. The defaults allow messages up to 16 MiB and 32 simultaneous RPCs per browser, which accommodates normal multimodal input while bounding accidental or hostile clients. Existing-server integrations can adjust both limits explicitly as shown above. The standalone `/api/status` response reports its protocol, capabilities, and active limits.

## Canvas recipe

Serialize only the selected or visible canvas state into a compact prompt. Keep canonical canvas state in the host application.

```ts
const selection = canvas.getSelection().map(({ id, type, text, x, y }) => ({ id, type, text, x, y }));
const result = await codex.chat(`Review these selected nodes:\n${JSON.stringify(selection)}`, { threadId });
canvas.showAssistantMessage(result.text);
```

If Codex should mutate the canvas, ask for structured JSON and validate it in the host before applying it.

## Voice recipe

Keep speech-to-text and text-to-speech in the host. Codex remains the reasoning and tool-use layer.

```ts
const transcript = await speechToText(audio);
const { text } = await codex.chat(transcript, { threadId });
await speak(text);
```

Subscribe to `item/agentMessage/delta` if the speech engine supports sentence-level streaming.

## Approval requests

The bridge forwards app-server requests as `serverRequest` messages. Respond with the request's JSON-RPC ID:

```ts
import { buildApprovalResponse, isApprovalRequest } from "t3-code-ultralight-browser-fork/requests";

codex.on("serverRequest", ({ id, method, params }) => {
  if (!isApprovalRequest(method)) return;
  showApproval({
    method,
    params,
    allow: () => codex.respond(id, buildApprovalResponse(method, "accept")),
    decline: () => codex.respond(id, buildApprovalResponse(method, "decline")),
  });
});
```

The helper handles both current `accept/decline` requests and legacy `approved/denied` requests.

Do not auto-approve requests in a reusable integration. Honor the user's existing Codex permission configuration and show prompts when the server asks. In multi-client use, the bridge routes an approval only to the client that started the active turn and rejects responses from other clients.

## Deployment boundary

This is a local application bridge, not a public hosted API. Bind the HTTP server to `127.0.0.1`. An allowed origin is not authentication and does not make exposing the port to a network safe. A remote deployment needs a separate authenticated transport design. Browsers may also apply mixed-content or local-network-access rules when an HTTPS site connects to a loopback service; those browser controls are outside this bridge's origin allowlist.
