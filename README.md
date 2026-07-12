# T3 Code Ultralight Browser Fork

[![CI](https://github.com/adamholter/t3-code-ultralight-browser-fork/actions/workflows/ci.yml/badge.svg)](https://github.com/adamholter/t3-code-ultralight-browser-fork/actions/workflows/ci.yml)

Give this repository to an agent and say:

> Allow our web app to talk to my local Codex. Use the ultralight chat UI, or use the headless client if our interface is custom.

Agents can read [`integration.json`](integration.json) for the versioned machine contract or [`llms.txt`](llms.txt) for discovery pointers instead of scraping this README.

This project is the smallest practical bridge between a browser UI and a user's local Codex. It packages the best chat interaction details from T3 Code as three reusable pieces:

1. A conflict-free embedded chat UI.
2. A headless browser client for canvas, voice, spatial, game, and custom interfaces.
3. A localhost-only Node bridge for `codex app-server`.

It uses the user's existing Codex login, configuration, models, skills, MCP tools, workspace permissions, and thread history. API keys and Codex credentials never enter browser JavaScript.

The complete chat ships in about 94 KB of decoded JavaScript plus CSS. Its response renderer has no external Markdown runtime: it creates escaped React nodes directly, keeps raw response HTML inert, and still covers the code, tables, tasks, links, quotes, and formatting Codex commonly emits.

The package boundary is exercised in clean React 18/19, Next.js 16 App Router, Vue 3, and Svelte 5 hosts. The React export carries its own client boundary for direct Server Component imports. Framework-driven custom-element attributes initialize a single frame, and controller calls made during mount wait safely for readiness.

## One-command integration

From the existing project's root, an agent can verify Codex, start or safely reuse the bridge, and receive one complete machine-readable host recipe in a single command:

```bash
npx --yes 'https://github.com/adamholter/t3-code-ultralight-browser-fork/releases/latest/download/t3-code-ultralight-browser-fork.tgz?v=0.46.1' setup --mode iframe --port auto --json
```

Use `--mode react`, `--mode element`, or `--mode custom` for a React wrapper, Web Component, or a canvas/voice/bespoke interface. Element and custom modes default to package imports; add `--delivery hosted` for a zero-install browser recipe that imports the bridge's live modules directly. The invoking directory becomes the bridge's default Codex workspace; add `--cwd /another/project/path` only to override it. `--port auto` safely reuses 4174 when compatible or selects a stable workspace-specific fallback when another project or service owns it. The receipt returns the resolved numeric port for later status and stop commands. Add `--allow-origin` when needed. The trusted JSON receipt reports the resolved workspace separately, while its copyable browser code inherits that workspace without embedding an absolute local path. It also contains diagnostics, verified bridge state, runtime-correct URLs, code language, exact CSP additions, disposal guidance, and verification endpoints. Failed diagnostics return nonzero without starting a bridge.

For example, a static canvas or voice tool with no npm or bundler can use:

```bash
npx --yes 'https://github.com/adamholter/t3-code-ultralight-browser-fork/releases/latest/download/t3-code-ultralight-browser-fork.tgz?v=0.46.1' setup --mode custom --delivery hosted --port auto --json
```

## One-command chat

Run the stable prebuilt release directly—no clone, install, build, or API key:

```bash
npx --yes 'https://github.com/adamholter/t3-code-ultralight-browser-fork/releases/latest/download/t3-code-ultralight-browser-fork.tgz?v=0.46.1' start
```

The command returns only after Codex is ready, then leaves the bridge running in the background. Embed `http://127.0.0.1:4174/?embed=1` or open `http://127.0.0.1:4174`. It is safe to repeat from the same project and reuses only a bridge with the same version, exact origin set, and exact workspace fingerprint.

## Install in a project

```bash
npm install 'https://github.com/adamholter/t3-code-ultralight-browser-fork/releases/latest/download/t3-code-ultralight-browser-fork.tgz?v=0.46.1'
npx t3-code-ultralight doctor
npx t3-code-ultralight start
```

The version query is an intentional npm cache key: the URL still resolves through GitHub's latest release, while each README revision forces npm to fetch the matching prebuilt package instead of reusing an older mutable-URL cache entry. No repository clone, Git checkout, or local compilation is involved. Use `npm install github:adamholter/t3-code-ultralight-browser-fork` when intentionally tracking source from `main`.

GitHub release archives are the canonical distribution path. Every published release triggers a clean Ubuntu build that reruns standard checks and the production dependency audit, recreates both archives, validates the exact npm publication payload with a dry run, attaches GitHub build provenance, and replaces the release assets with those verified outputs. The same idempotent workflow can additionally publish to the public npm registry only after an administrator both configures `NPM_TOKEN` and explicitly sets `NPM_PUBLISH_ENABLED=true`; an inherited or stale token cannot activate publication by itself.

`doctor` performs a read-only live check of the Codex binary, app-server handshake, login, model catalog, and local thread store. Add `--json` for agent-readable diagnostics.

`setup` composes `doctor`, safe background startup, and a mode-specific integration recipe. It is the recommended entry point for unfamiliar agents because one JSON result proves prerequisites and describes the next host edit without requiring README parsing.

`start` launches in the background, waits for verified readiness, and returns the resolved workspace, PID, and private temporary log path. The current directory is the default workspace unless `--cwd` is supplied. It reuses an exact version/origin/workspace match already running on the requested port, but fails before startup when any differs. The browser status exposes only a workspace fingerprint, never the local path. Add `--json` for agent-readable output. Use `serve` instead when a foreground process is preferable. Inspect either mode without starting Codex using:

```bash
npx t3-code-ultralight status --json
```

Stop only a verified Ultralight bridge, including before an upgrade or origin change, with:

```bash
npx t3-code-ultralight stop
```

`stop` is idempotent and supports `--port` and `--json`; it will not signal an unrelated listener.

The CLI rejects unknown commands, typoed options, duplicate singleton flags, and stray values before probing a port or starting a process. Run `t3-code-ultralight --help` for the exact accepted command shapes; `--allow-origin` is the intentionally repeatable option.

The full chat runs at `http://127.0.0.1:4174`. The isolated embed is:

```html
<iframe
  src="http://127.0.0.1:4174/?embed=1"
  title="Local Codex chat"
  style="width:100%;height:100%;min-height:420px;border:0"
></iframe>
```

Plain HTML needs no bundler or package import. The running bridge serves a stable, self-registering Web Component module:

```html
<script type="module" src="http://127.0.0.1:4174/codex-chat.js"></script>
<codex-chat bridge-url="http://127.0.0.1:4174"></codex-chat>
```

For a no-bundler canvas, voice, or other custom UI, `setup --mode custom --delivery hosted --json` returns exact imports for the standalone client and request adapters served by the running bridge. Localhost pages are allowed by default; non-loopback pages still require their exact `--allow-origin` value. All module routes use that same origin policy and expose no credentials.

Custom browser UIs served from a non-loopback origin must opt that exact origin into the local bridge:

```bash
npx t3-code-ultralight start --allow-origin https://canvas.example.com
```

Repeat `--allow-origin` for additional hosts. The bridge still binds only to `127.0.0.1`; wildcards are intentionally unsupported.

Every setup recipe includes an `originPolicy` object. It records that loopback browser origins work automatically, lists the exact additional origins configured for this bridge, and names the required `--allow-origin <exact browser origin>` flag for any other host. The HTTPS non-loopback path is tested with real browser CORS and WebSocket Origin headers; an unlisted sibling is rejected on both transports.

A trusted standalone HTML file can use the same zero-install recipe with `--allow-origin null`. Browsers represent `file://` and sandboxed documents with the opaque Origin value `null`; the receipt sets `originPolicy.opaqueOriginAllowed: true` only when that access was explicitly requested. The complete chat's `frame-ancestors` policy also adds `file:` only under this explicit grant. Do not grant `null` to untrusted local files or sandboxed content.

```bash
npx t3-code-ultralight setup --mode custom --delivery hosted --allow-origin null --json
```

Reuse is fail-closed: a loopback-only invocation will not silently inherit extra origins from an existing bridge. If a host intentionally accepts an already-running origin superset, it must pass `--reuse-origin-superset`; JSON output then reports `originSupersetAccepted: true` and lists every extra origin.

Projects with an ESM bundler can instead use the package export:

```ts
import "t3-code-ultralight-browser-fork/element/auto";
```

```html
<codex-chat
  bridge-url="http://127.0.0.1:4174"
  title="Project assistant"
  min-height="560px"
></codex-chat>
```

It is safe to import during SSR and upgrades automatically once a browser DOM exists. Use `defineCodexChatElement()` when the host needs a custom tag name or explicit registration timing.

The element emits origin-verified `codex-chat-ready`, `codex-chat-connection`, `codex-chat-thread`, `codex-chat-turn`, `codex-chat-command`, and `codex-chat-error` events. Events carry lifecycle metadata and command acknowledgements only—never prompts, responses, credentials, or tool payloads.

Canvas, voice, and other host controls can drive the complete chat without rebuilding its renderer:

```ts
const chat = document.querySelector("codex-chat");
await chat.sendPrompt(transcript, { cwd: projectPath, newThread: true });
await chat.stop();
await chat.newThread();
```

Calls made before the iframe is ready wait for its command channel. `sendPrompt()` resolves when Codex accepts the turn and returns only its thread and turn IDs; streamed response content stays inside the isolated chat.

Use `bridge-url="http://127.0.0.1:4174/?mode=plan"` when the embedded chat should run in Codex Plan mode and support interactive clarification questions.

React projects can use the wrapper:

```tsx
"use client";

import { useRef } from "react";
import { CodexChatEmbed, type CodexChatEmbedHandle } from "t3-code-ultralight-browser-fork/react";

export function AssistantPanel() {
  const codex = useRef<CodexChatEmbedHandle>(null);
  return (
    <>
      <button onClick={() => codex.current?.sendPrompt("Explain the selected canvas nodes")}>Ask Codex</button>
      <CodexChatEmbed
        controllerRef={codex}
        style={{ height: 640 }}
        onCodexReady={({ modelCount }) => console.log(`${modelCount} models ready`)}
        onTurnChange={({ phase }) => setAssistantBusy(phase === "started")}
      />
    </>
  );
}
```

The React export supports host-provided React 18 or 19. The exact packed component is browser-tested in clean React 18.3.1 and 19.2.0 Vite hosts under Strict Mode, server-rendered with both `react-dom/server` versions, and hydrated in Chromium without mismatches or duplicate frames. The published module begins with `"use client"`, and a Next.js 16.2.10 production App Router host imports it directly from a Server Component and streams a real Codex turn. Generated React recipes also include an explicit client boundary so agents can paste them into server-first projects safely. Ready/connection/turn callbacks, controller refs, stop/new-thread controls, and unmount/remount cleanup are exercised with real Codex turns. React remains an optional peer, so headless, Web Component, and server-only installs do not pull it in.

The iframe is intentional: T3's polished chat CSS stays isolated from the host app, making this the safest one-line integration.

Raw iframe hosts can load the same dependency-free controller directly from the running bridge:

```ts
import { createCodexEmbedController } from "http://127.0.0.1:4174/codex-embed.js";

const codex = createCodexEmbedController(document.querySelector("#local-codex"));
await codex.send("Explain the current selection", { cwd: projectPath });
```

The child accepts commands only from its exact parent window and an origin allowed by the bridge. Loopback hosts work automatically; a non-loopback or trusted `file://` parent must use the same explicit `--allow-origin` policy as the headless client. Spoofed origins are ignored without acknowledgement.

## Custom canvas or voice UI

Use the headless client when the host owns the interface:

```ts
import { createCodexSession } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexSession();

const answer = await codex.send("Explain the selected canvas nodes", {
  onDelta: (_delta, text) => renderStreamingText(text),
});

console.log(answer.text);
```

No connection URL or working directory is required for the standard standalone bridge: the session inherits the bridge workspace selected by `setup` or `start`. Pass `cwd` only for a per-session override, `bridgeUrl: "http://127.0.0.1:PORT"` for another standalone port, or an exact WebSocket `url` for a custom path on an attached server. The session remembers its thread automatically and sends healthy follow-ups without a redundant resume round trip. After a bridge or Codex app-server reconnect, it resumes once before continuing. Call `codex.stop()` to cancel while keeping the session reusable, `codex.reset()` for a new conversation, and `await codex.close()` for final disposal. Closing is idempotent, prevents reuse, and waits for any active `turn/interrupt` acknowledgment before releasing an owned socket. Pass an input array instead of a string for images, local images, skills, or mentions.

Custom interfaces can cover every interactive request with one fail-closed adapter:

```ts
import { attachCodexRequestHandlers } from "t3-code-ultralight-browser-fork/requests";

const detachRequests = attachCodexRequestHandlers(codex.client, {
  approval: async (request) => yourUI.approve(request) ? "accept" : "decline",
  userInput: (questions) => yourUI.ask(questions),
  permission: (request) => yourUI.reviewPermission(request),
  mcpForm: (request, defaults) => yourUI.fill(request, defaults),
  mcpUrl: (request) => yourUI.openAuthorization(request),
});
```

Missing handlers decline or skip safely, and `currentTime/read` is answered automatically.

When several UI surfaces share one socket, give each surface its own session-scoped adapter so prompts cannot race across canvas, voice, or other panels:

```ts
import { createCodexClient, createCodexSession } from "t3-code-ultralight-browser-fork/client";
import { attachCodexSessionRequestHandlers } from "t3-code-ultralight-browser-fork/requests";

const client = createCodexClient();
const canvas = createCodexSession({ client, cwd: projectPath });
const voice = createCodexSession({ client, cwd: projectPath });
const detachCanvasRequests = attachCodexSessionRequestHandlers(canvas, canvasHandlers);
const detachVoiceRequests = attachCodexSessionRequestHandlers(voice, voiceHandlers);
```

Both sessions stream independently over one WebSocket. Closing either session preserves the shared client and its sibling; close the client after every shared session is disposed.

For shared clients or lower-level control, use `createCodexClient()` and subscribe directly:

```ts
import { createCodexClient } from "t3-code-ultralight-browser-fork/client";

const client = createCodexClient();
client.on("item/agentMessage/delta", ({ delta }) => renderToken(delta));
client.on("item/started", ({ item }) => renderToolActivity(item));
client.on("turn/completed", ({ turn }) => markComplete(turn));
```

TypeScript infers stable event payloads, model/thread catalogs, and final turn objects. Known events reject incompatible handlers at compile time; an unknown string event retains an `any` payload as a forward-compatible escape hatch for new Codex notifications.

See [Integration guide](docs/INTEGRATION.md) for canvas, voice, and existing-server recipes.

The programmatic `t3-code-ultralight-browser-fork/integration` export materializes runtime-aware contracts and typed recipes when another installer or agent tool needs to build its own setup flow.

## Attach it to an existing Node server

```ts
import { createServer } from "node:http";
import { attachCodexBridge } from "t3-code-ultralight-browser-fork/server";

const server = createServer(yourApp);
const codex = attachCodexBridge(server, { path: "/codex-ws" });

await codex.start();
server.listen(3000, "127.0.0.1");
```

Point the browser client at `ws://127.0.0.1:3000/codex-ws`.

For a browser UI served elsewhere, pass its exact origin as `allowedOrigins: ["https://canvas.example.com"]`.

The attached bridge handles only its exact configured pathname and leaves every other HTTP upgrade untouched, so the host can keep its own WebSocket routes. `await codex.stop()` is idempotent and final: it first closes Codex browser sockets while pending owned requests can still be rejected, forcibly terminates non-cooperative clients after one second, removes every listener Ultralight added, and then stops Codex while leaving the host server running. Set `browserSocketCloseTimeoutMs` only when the host needs a different shutdown bound. Create a new controller to attach again after stopping.

The public controller exposes a minimal structural WebSocket-server handle rather than leaking the internal `ws` implementation type, so TypeScript hosts do not need to install `@types/ws` merely to import the server API.

## Included behavior

- Existing and new local Codex threads
- Fast streamed assistant text and reasoning
- Commands, file changes, MCP calls, and tool activity
- Approval and stop controls
- Interactive Codex questions with options, free text, secret inputs, and multi-question forms
- Structured permission review with exact capability details, turn/session scope, and strict command review
- MCP elicitation forms for text, numbers, booleans, selects, multi-selects, and safe authorization URLs
- Model, reasoning effort, and working-directory selection
- Markdown, code copy, desktop/mobile layouts, and themes
- Built-in safe response Markdown with no raw-HTML execution or external Markdown runtime dependency
- Automatic local bridge restart and browser reconnect
- Read-only `doctor` diagnostics with actionable failures and JSON output
- Project-root workspace defaults, exact-workspace process reuse, and path-private browser status
- Idempotent startup plus human and JSON runtime status inspection
- Framework-free WebSocket client plus typed React and server exports
- Preact-powered standalone chat with a genuine React wrapper for React hosts
- One-call `chat()` plus lower-level text and multimodal turn APIs
- Stateful `send()` sessions with scoped streaming events and real turn cancellation
- Approval requests routed only to the browser client that owns the active turn
- Thread-scoped deltas, tool activity, and lifecycle notifications routed only to their owning browser
- Unowned server requests and duplicate cross-client responses rejected instead of broadcast
- Strict browser envelopes, 16 MiB payload bounds, and 32 in-flight RPCs per client by default
- Versioned browser handshake with early protocol and required-capability validation
- Exact-origin WebSocket policy with secure loopback defaults and no wildcard mode
- No-store HTML/metadata, immutable hashed assets, stale-asset 404s, and an embed-compatible CSP
- Enforced 110 KB decoded JavaScript-plus-CSS ceiling for the complete browser app
- Dependency-free Web Component with Shadow DOM and SSR-safe registration
- No-bundler chat and headless-client modules served directly by the local bridge
- Origin-verified embed lifecycle events and host commands without response-data leakage
- Exported request parsers and response builders for fully custom interfaces
- One-subscription request adapter for approvals, questions, permissions, MCP, time, and safe fallbacks
- Exported negotiated bridge version, capabilities, and active transport limits
- Automatic whole-second current-time replies and stale request cleanup in the complete chat

## Deliberately excluded

- Claude Code, OpenCode, Cursor, and provider registries
- Cloud credentials or browser-side API keys
- Electron, Expo, auth, remote sync, SSH, Tailscale, and marketing surfaces
- Database projections and multi-environment orchestration

## Develop

Requirements: Node 22+ and a working `codex` CLI login.

```bash
npm install
npm run qa:install
npm run dev
```

- Web UI: `http://127.0.0.1:4173`
- Local bridge: `ws://127.0.0.1:4174/ws`

Validation:

```bash
npm run check
npm run qa:auto-port
npm run qa:live
```

Print the canonical agent handoff at any time:

```bash
npx t3-code-ultralight agent-prompt
```

## Security boundary

Keep the bridge on loopback unless you add authentication, origin checks, TLS, and an explicit permission model. It gives the browser access to the same local Codex capabilities the user has configured.

## Agent integration

Agents should read [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md). It defines the shortest correct route and the security constraints that must survive integration.

## Attribution

Derived from the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code). This fork retains the original license and focuses only on the local Codex browser path.
