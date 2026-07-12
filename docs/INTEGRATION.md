# Integration guide

Choose the narrowest mode that fits the host product.

## Preflight

For a new integration, run the combined setup receipt from the host project's root:

```bash
npx t3-code-ultralight setup --mode iframe --json
```

Choose `iframe`, `react`, `element`, or `custom`. Element and custom recipes default to package delivery; pass `--delivery hosted` when the browser must import bridge-served modules without npm or a bundler. Iframe is always hosted and React is always package-delivered; incompatible combinations fail before diagnostics or startup. The command runs the same read-only diagnostics below, makes its invoking directory the bridge's default Codex workspace, starts or reuses only a version/origin/workspace-compatible background bridge, and returns a typed recipe with runtime URLs, copyable path-free browser code, code language, exact CSP source additions, cleanup guidance, and verification endpoints. The sibling trusted bridge receipt contains the resolved workspace. Pass `--cwd` only to choose a different bridge workspace; it is still not embedded in generated browser source. All standalone lifecycle and origin flags accepted by `start` are also accepted by `setup`.

Every recipe includes `workspace: { default: "bridge", overrideEmbedded: false }` unless a programmatic recipe author intentionally passes `cwd` to `createIntegrationRecipe()`. Setup never does so because the standalone bridge already owns the verified workspace default.

Run diagnostics separately when setup and host editing are intentionally split:

```bash
npx t3-code-ultralight doctor
```

For automation or agent parsing, use `doctor --json`. The command is read-only and does not create a thread.

The packaged `integration.json` describes the default port. A running bridge's `/api/integration` and `/integration.json` responses are materialized for its actual port; use the live response when generating links for a nondefault bridge. Installer authors can import `createIntegrationRecipe()` and `materializeRuntimeIntegrationContract()` from `t3-code-ultralight-browser-fork/integration`.

Use `t3-code-ultralight status --json` to inspect a standalone bridge without starting Codex. `serve` and `start` are idempotent only for an identical version, allowed-origin set, and normalized workspace fingerprint, making repeated agent setup safe without silently inheriting broader access or another project's default directory. A conflicting version, workspace, any missing or extra origin, invalid port, or unrelated listener fails with an actionable message. Status never returns the workspace path; the trusted setup/start receipt does. Use `t3-code-ultralight stop [--port PORT] [--json]` before an upgrade, origin change, or workspace change; it validates the service identity and reported PID, waits for shutdown, and is safe to repeat. Pass `--reuse-origin-superset` only when the invoking host intentionally accepts every additional origin already configured; the JSON receipt exposes the accepted extras.

CLI parsing is strict and occurs before side effects. Unknown commands/options, misspellings, duplicate `--port`/`--codex`/`--cwd`/boolean flags, and positional arguments fail nonzero. Only `--allow-origin` may repeat. Use `t3-code-ultralight --help` as the authoritative syntax reference instead of guessing flag names.

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

The element also exposes a small imperative controller. Calls made during iframe startup wait for the verified command receiver:

```ts
const chat = document.querySelector("codex-chat");
const accepted = await chat.sendPrompt(transcript, {
  cwd: projectPath,
  newThread: true,
});
console.log(accepted.threadId, accepted.turnId);

await chat.stop();       // idempotent if the turn already completed
await chat.newThread();  // clears the embedded conversation
```

The acknowledgement never contains the prompt or response. Listen for `codex-chat-turn` to mirror busy state while rendered content remains isolated in the iframe.

For explicit registration or a custom tag:

```ts
import { defineCodexChatElement } from "t3-code-ultralight-browser-fork/element";
defineCodexChatElement({ tagName: "my-codex", defaultBridgeUrl: "/local-codex" });
```

## Mode 1: isolated chat embed

Use this when the product needs a complete chat surface quickly. It has no CSS or state collisions with the host.

The isolated page uses Preact internally to minimize its standalone download. The `CodexChatEmbed` wrapper below remains a normal React component and does not replace or alias React inside the host application. The published package is verified in clean React 18.3.1 and 19.2.0 browser hosts and through `react-dom/server` plus browser hydration for both generations, including Strict Mode and unmount/remount cleanup.

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

Use an imperative ref when an existing canvas or voice control should send into the polished chat:

```tsx
const codex = useRef<CodexChatEmbedHandle>(null);

<CodexChatEmbed controllerRef={codex} />

await codex.current?.sendPrompt("Explain the selected nodes", {
  cwd: projectPath,
  newThread: true,
});
await codex.current?.stop();
```

The complete event set is `connection`, `ready`, `thread`, `turn`, `command`, and `error`. Command events contain only the command name, success state, request ID, and optional thread/turn IDs. Events intentionally exclude prompt text, response text, credentials, and tool payloads.

The complete chat renders Markdown into React nodes without injecting response HTML. It supports the response structures Codex commonly emits—including fenced/inline code, lists and tasks, tables, quotes, links, images, and emphasis—while leaving HTML literal and rejecting unsafe URL protocols. The built-in renderer has no external Markdown runtime dependency; `npm run qa:markdown` verifies representative desktop/mobile output and the 110 KB application budget.

Raw iframe hosts can use the same exact-window and exact-origin filter:

```ts
import { subscribeCodexEmbedEvents } from "t3-code-ultralight-browser-fork/embed-events";

const unsubscribe = subscribeCodexEmbedEvents(iframe, (event) => {
  if (event.event === "turn") setBusy(event.phase === "started");
});
```

Raw iframe hosts can use the framework-neutral controller from the package or the bridge-served zero-install module:

```ts
import { createCodexEmbedController } from "http://127.0.0.1:4174/codex-embed.js";

const controller = createCodexEmbedController(iframe);
await controller.send("Explain this selection", { cwd: projectPath });
controller.dispose();
```

`ready()` uses a side-effect-free ping and retries during iframe startup. `send()`, `stop()`, and `newThread()` call it automatically. Dispose the raw controller when its iframe is removed; React and the Web Component do this automatically.

## Browser origins

The bridge accepts browser connections from `localhost`, `127.0.0.1`, and `[::1]` by default. This covers normal local development regardless of port. A custom UI running on a non-loopback browser origin needs an explicit exact-origin allowlist entry:

```bash
npx t3-code-ultralight start \
  --allow-origin https://canvas.example.com \
  --allow-origin http://192.168.1.20:3000
```

Use scheme, host, and optional port only. Paths, credentials, comma-separated values, and `*` are rejected. Use `--allow-origin null` only when a trusted `file://` or sandboxed host is intentional. This changes which browser pages may connect; it never changes the server's `127.0.0.1` bind address.

When `null` is explicitly configured, the recipe reports `originPolicy.opaqueOriginAllowed: true` and the complete chat adds `file:` to its `frame-ancestors` policy. Without that explicit grant, `file://` framing remains blocked. `npm run qa:file` opens the generated hosted recipe directly from a temporary file, verifies module responses use `Access-Control-Allow-Origin: null`, drives both a headless and complete-chat turn, and removes the file afterward. Never treat `null` as a wildcard: it represents every opaque-origin document, so grant it only when the local file or sandbox is trusted.

The setup recipe repeats the effective policy under `originPolicy`: `loopbackAutomatic`, deduplicated `additionalAllowedOrigins`, and `nonLoopbackRequiresExactFlag`. This keeps extracted integration recipes self-contained. `npm run qa:origin` exercises the generated hosted recipe from a temporary HTTPS non-loopback hostname, verifies exact CORS and WebSocket acceptance, and confirms an unlisted sibling hostname is denied by both transports.

Origin sets are compared exactly during normal process reuse. For example, running `start` without `--allow-origin` refuses to reuse a bridge that already allows `https://canvas.example.com`, even though the requested empty set is technically a subset. This prevents a new tool from unknowingly inheriting another tool's broader browser access.

The isolated chat iframe connects from its own loopback origin, so a view-only parent page does not need an entry. A parent that sends imperative embed commands is checked against the same browser-origin policy as a headless client: loopback works automatically, while non-loopback and opaque parents require their exact `--allow-origin` entry. Each command must also come from the iframe's actual parent window. Invalid sources, spoofed origins, malformed payloads, empty or oversized prompts, and commands from an unconfigured `file://` page are ignored without acknowledgement.

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

For the standard standalone bridge, `createCodexSession()` with no options inherits the workspace selected when the bridge started. Supply `cwd` only when this particular surface intentionally targets a different directory.

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

These event names are keys of the exported `CodexClientEventMap`, so callback payloads infer automatically in TypeScript. Stable turn, item, delta, status, bridge, error, and request shapes are exported individually for host state models. Literal unknown event names remain accepted with an `any` payload; this preserves access to newly introduced Codex notifications without weakening known-event checking.

`listModels()` returns `CodexModel[]`, `listThreads()` returns `CodexThread[]`, and `RunTurnResult.turn` carries the typed stable turn envelope. The generic `request<T>()` remains available for app-server methods outside the convenience surface.

The generic `request(method, params)` method exposes the complete app-server RPC surface without forcing this SDK to freeze the entire evolving protocol. `runTurn()` and `runInput()` are available when the host manages thread lifecycle itself.

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

The standalone bridge does not expose the user's home or working path through status metadata. HTML and JSON metadata are `no-store`; content-hashed JavaScript/CSS are immutable; missing asset filenames return 404 instead of the SPA shell. Static UI responses add nosniff, no-referrer, and a restrictive CSP while intentionally allowing cross-origin framing for the supported embed route. Do not add `X-Frame-Options` or narrow `frame-ancestors` in a wrapper proxy unless embedding is intentionally disabled.
