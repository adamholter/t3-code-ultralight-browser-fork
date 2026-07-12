# Integration guide

Choose the narrowest mode that fits the host product.

## Preflight

Run this before integration work:

```bash
npx t3-code-ultralight doctor
```

For automation or agent parsing, use `doctor --json`. The command is read-only and does not create a thread.

## Mode 0: framework-neutral Web Component

Use this for Vue, Svelte, Angular, Lit, Astro, vanilla TypeScript, or any host that supports custom elements:

```ts
import "t3-code-ultralight-browser-fork/element/auto";
```

```html
<codex-chat bridge-url="/local-codex" min-height="560px"></codex-chat>
```

Supported attributes are `bridge-url`, `title`, `min-height`, and `loading`. Style the isolated frame through `codex-chat::part(frame)`. Listen for `codex-chat-ready` when it loads.

For explicit registration or a custom tag:

```ts
import { defineCodexChatElement } from "t3-code-ultralight-browser-fork/element";
defineCodexChatElement({ tagName: "my-codex", defaultBridgeUrl: "/local-codex" });
```

## Mode 1: isolated chat embed

Use this when the product needs a complete chat surface quickly. It has no CSS or state collisions with the host.

```tsx
import { CodexChatEmbed } from "t3-code-ultralight-browser-fork/react";

<CodexChatEmbed bridgeUrl="http://127.0.0.1:4174" />
```

Start the bridge with `npx t3-code-ultralight serve`.

## Mode 2: headless client

Use this for canvas, voice, spatial, game, terminal, or product-specific interfaces.

```ts
import { createCodexClient } from "t3-code-ultralight-browser-fork/client";

const codex = createCodexClient({ url: "ws://127.0.0.1:4174/ws" });
await codex.connect();

const result = await codex.chat(prompt, {
  cwd: projectPath,
  model: selectedModel,
  effort: "low",
});
```

`chat()` creates a thread automatically. Continue it with `{ threadId: result.threadId }`. For images or other rich inputs, pass an array:

```ts
await codex.chat([
  { type: "image", url: imageDataUrl },
  { type: "text", text: "Explain this screenshot" },
], { cwd: projectPath });
```

Useful events:

| Event | Use |
| --- | --- |
| `item/agentMessage/delta` | Append streamed response text |
| `item/started` | Show a command, file edit, MCP call, or reasoning item |
| `item/completed` | Replace the item with its final status and output |
| `turn/started` | Show running state and save the turn ID |
| `turn/completed` | Resolve UI state and surface errors |
| `serverRequest` | Render approval or user-input requests |

The generic `request(method, params)` method exposes the complete app-server RPC surface without growing this SDK. `runTurn()` and `runInput()` are available when the host manages thread lifecycle itself.

## Mode 3: existing Node server

Attach to an existing `node:http` server rather than launching a second service:

```ts
import { attachCodexBridge } from "t3-code-ultralight-browser-fork/server";

const controller = attachCodexBridge(httpServer, {
  path: "/codex-ws",
  cwd: process.cwd(),
});

await controller.start();
```

Call `await controller.stop()` during graceful shutdown.

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
codex.on("serverRequest", ({ id, method, params }) => {
  showApproval({
    method,
    params,
    allow: () => codex.respond(id, { decision: "accept" }),
    decline: () => codex.respond(id, { decision: "decline" }),
  });
});
```

Do not auto-approve requests in a reusable integration. Honor the user's existing Codex permission configuration and show prompts when the server asks. In multi-client use, the bridge routes an approval only to the client that started the active turn and rejects responses from other clients.

## Deployment boundary

This is a local application bridge, not a public hosted API. Bind the HTTP server to `127.0.0.1`. A remote deployment needs a separate authenticated transport design.
