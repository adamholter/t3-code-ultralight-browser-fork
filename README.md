# T3 Code Ultralight Browser Fork

[![CI](https://github.com/adamholter/t3-code-ultralight-browser-fork/actions/workflows/ci.yml/badge.svg)](https://github.com/adamholter/t3-code-ultralight-browser-fork/actions/workflows/ci.yml)

Give this repository to an agent and say:

> Allow our web app to talk to my local Codex. Use the ultralight chat UI, or use the headless client if our interface is custom.

This project is the smallest practical bridge between a browser UI and a user's local Codex. It packages the best chat interaction details from T3 Code as three reusable pieces:

1. A conflict-free embedded chat UI.
2. A headless browser client for canvas, voice, spatial, game, and custom interfaces.
3. A localhost-only Node bridge for `codex app-server`.

It uses the user's existing Codex login, configuration, models, skills, MCP tools, workspace permissions, and thread history. API keys and Codex credentials never enter browser JavaScript.

## Fastest path

```bash
npm install github:adamholter/t3-code-ultralight-browser-fork
npx t3-code-ultralight doctor
npx t3-code-ultralight serve
```

`doctor` performs a read-only live check of the Codex binary, app-server handshake, login, model catalog, and local thread store. Add `--json` for agent-readable diagnostics.

The full chat runs at `http://127.0.0.1:4174`. The isolated embed is:

```html
<iframe
  src="http://127.0.0.1:4174/?embed=1"
  title="Local Codex chat"
  style="width:100%;height:100%;min-height:420px;border:0"
></iframe>
```

Custom browser UIs served from a non-loopback origin must opt that exact origin into the local bridge:

```bash
npx t3-code-ultralight serve --allow-origin https://canvas.example.com
```

Repeat `--allow-origin` for additional hosts. The bridge still binds only to `127.0.0.1`; wildcards are intentionally unsupported.

Any framework with an ESM bundler can use the Web Component:

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

Use `bridge-url="http://127.0.0.1:4174/?mode=plan"` when the embedded chat should run in Codex Plan mode and support interactive clarification questions.

React projects can use the wrapper:

```tsx
import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";

export function AssistantPanel() {
  return <CodexChatEmbed style={{ height: 640 }} />;
}
```

The iframe is intentional: T3's polished chat CSS stays isolated from the host app, making this the safest one-line integration.

## Custom canvas or voice UI

Use the headless client when the host owns the interface:

```ts
import { createCodexClient } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexClient({
  url: "ws://127.0.0.1:4174/ws",
});

const answer = await codex.chat("Explain the selected canvas nodes", {
  cwd: "/absolute/project/path",
});

console.log(answer.text);
```

Continue later with `codex.chat("follow-up", { threadId: answer.threadId })`. Pass an input array instead of a string for images, local images, skills, or mentions.

For token-by-token display, subscribe directly:

```ts
codex.on("item/agentMessage/delta", ({ delta }) => renderToken(delta));
codex.on("item/started", ({ item }) => renderToolActivity(item));
codex.on("turn/completed", ({ turn }) => markComplete(turn));
```

See [Integration guide](docs/INTEGRATION.md) for canvas, voice, and existing-server recipes.

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

## Included behavior

- Existing and new local Codex threads
- Fast streamed assistant text and reasoning
- Commands, file changes, MCP calls, and tool activity
- Approval and stop controls
- Interactive Codex questions with options, free text, secret inputs, and multi-question forms
- Model, reasoning effort, and working-directory selection
- Markdown, code copy, desktop/mobile layouts, and themes
- Automatic local bridge restart and browser reconnect
- Read-only `doctor` diagnostics with actionable failures and JSON output
- Framework-free WebSocket client plus typed React and server exports
- One-call `chat()` plus lower-level text and multimodal turn APIs
- Approval requests routed only to the browser client that owns the active turn
- Exact-origin WebSocket policy with secure loopback defaults and no wildcard mode
- Dependency-free Web Component with Shadow DOM and SSR-safe registration
- Exported request parsers and response builders for fully custom interfaces

## Deliberately excluded

- Claude Code, OpenCode, Cursor, and provider registries
- Cloud credentials or browser-side API keys
- Electron, Expo, auth, remote sync, SSH, Tailscale, and marketing surfaces
- Database projections and multi-environment orchestration

## Develop

Requirements: Node 22+ and a working `codex` CLI login.

```bash
npm install
npm run dev
```

- Web UI: `http://127.0.0.1:4173`
- Local bridge: `ws://127.0.0.1:4174/ws`

Validation:

```bash
npm run check
node tests/qa.mjs
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
