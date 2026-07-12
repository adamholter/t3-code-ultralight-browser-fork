# Agent integration contract

Read `/integration.json` first when machine-readable mode selection, commands, exports, URLs, or acceptance checks are preferable to prose. An installed CLI prints the packaged default-port contract with `t3-code-ultralight integration`; a running bridge serves a runtime-materialized contract from `/api/integration`, so every URL and lifecycle command follows its actual port.

When a user gives you this repository and asks to let an existing tool talk to Codex:

1. Identify whether the host needs the complete chat, a custom UI, or an existing-server attachment.
2. Prefer the prebuilt package's one-command receipt: `npx --yes 'https://github.com/adamholter/t3-code-ultralight-browser-fork/releases/latest/download/t3-code-ultralight-browser-fork.tgz?v=0.34.0' setup --mode MODE --json`, where `MODE` is `iframe`, `react`, `element`, or `custom`. It runs diagnostics, starts or reuses a compatible bridge, and returns the exact install command, runtime URLs, code, cleanup rule, and verification endpoints; no clone or build is required. Add `--delivery hosted` for a no-npm/no-bundler `element` or `custom` host, `--cwd` for a custom session, and the same `--port`, `--allow-origin`, or `--reuse-origin-superset` options used by `start`.
   Keep the documented version query intact because it prevents npm from reusing an older cached release. Install the receipt's versioned URL only when the chosen recipe imports package exports.
   For `delivery: "hosted"`, do not install or copy generated modules. Use the receipt's HTTP imports, apply its `csp` sources when the host has a CSP, and serve the host from an origin allowed by the bridge.
3. Resolve every failed doctor check or report its exact recommendation.
   Treat any CLI parse error as a failed setup step; do not retry by dropping an unrecognized security or lifecycle flag.
   `setup` and `start` safely reuse a compatible bridge and return only after readiness. Use `npx t3-code-ultralight status --json` for a separate inspection.
   Require an exact allowed-origin match. Use `--reuse-origin-superset` only when the host explicitly intends to inherit every extra origin shown in the JSON receipt.
   If a verified bridge must be replaced for an upgrade or origin change, use `npx t3-code-ultralight stop --json`; never kill an unverified listener by port alone.
4. Use the Web Component for a normal non-React chat panel and the React wrapper in React hosts.
   Wire the host's loading, connection, and busy states to the provided embed lifecycle events instead of probing iframe DOM.
   For plain HTML without a bundler, load `/codex-chat.js` directly from the running bridge; do not copy generated files into the host.
5. Use `createCodexSession()` for a normal canvas, voice, game, spatial, or bespoke interface; use the lower-level client only when the host manages threads or shares a socket.
   Do not configure a socket URL for the standard port-4174 standalone bridge. Use `bridgeUrl` for another standalone port and raw `url` only for an attached server's custom WebSocket path.
   Let the session manage thread readiness so healthy follow-ups avoid redundant resume RPCs and reconnect recovery remains automatic.
   Dispose with `await session.close()` (or `void session.close()` in a synchronous unmount hook) so active turns are interrupted before an owned socket closes.
   Attach `attachCodexRequestHandlers()` once instead of recreating approval, question, permission, MCP, time, and unsupported-request switching in every host.
   If multiple sessions share one client but render prompts in separate surfaces, attach `attachCodexSessionRequestHandlers()` once per session so siblings never race the same request.
   Use the exported `CodexClientEventMap` and inferred callbacks instead of recreating stable event payload interfaces; retain the unknown-event escape hatch only for protocol events the package does not yet type.
6. Attach the bridge to the host's existing Node HTTP server when practical; otherwise run the included localhost service.
7. Keep the bridge bound to loopback.
8. If a headless browser client is not served from loopback, allow only its exact browser origin with `--allow-origin` or `allowedOrigins`; never use a wildcard.
9. Never copy Codex credentials, cookies, access tokens, or config secrets into the browser.
10. Preserve approval and user-input requests instead of silently accepting them.
    Never broadcast an unowned request or forward a response without recorded ownership.
    Never broadcast thread-scoped notifications; deltas and tool activity belong only to the recorded thread owner.
    Render structured permission capabilities and scope explicitly; never map them to a generic approval payload.
    Render supported MCP elicitation schemas as typed controls and fail closed on nested, unknown, or unsafe schemas.
11. Verify one real local Codex turn through the final user-facing UI.

## Minimal agent task

```text
Install https://github.com/adamholter/t3-code-ultralight-browser-fork.
Allow this web app to talk to the user's local Codex.
Use the stable prebuilt release asset linked in the README so installation does not compile the package.
Run the package `setup --mode ... --json` command and follow its receipt. Use the isolated chat embed unless the existing UI needs custom rendering.
Keep the bridge localhost-only, preserve approvals, and verify one live turn.
```

## Acceptance checklist

- The host starts without manual source copying.
- `doctor --json` reports `ok: true`.
- The bridge reports ready.
- Mistyped commands and options fail nonzero before starting or changing a process.
- Re-running `setup` or `start` reuses only an exact version/origin match or explains the conflict.
- Every URL in the live integration contract follows the bridge's actual port.
- At least one local model is available.
- A thread can be started or resumed.
- Assistant deltas stream visibly.
- Tool activity does not crash the renderer.
- Stop and approval paths remain operable.
- Permission requests show exact capabilities and return schema-correct turn or session grants.
- MCP primitive forms return typed content; authorization links are explicit, credential-free HTTP(S) URLs.
- Custom sessions retain their thread, scope streamed events, and interrupt Codex when stopped.
- No secret is present in browser storage or bundles.
- Non-loopback browser origins are explicit and exact; unlisted origins are rejected.
- A generated hosted recipe streams from an allowed HTTPS non-loopback origin while an unlisted sibling fails both module and WebSocket access.
- Mobile or constrained-container layout does not overflow.
- Embedded hosts receive ready and turn lifecycle events only from the expected iframe origin.
- Malformed, oversized, over-concurrent, unowned, and duplicate-response transport paths fail closed.
- A passive second browser cannot observe another browser's thread-scoped notifications.
- The negotiated browser protocol major is compatible and required capabilities are advertised before RPCs begin.
- Plain HTML integrations load the hosted module directly and pass exact-origin CORS without copying build artifacts.
- The exact generated hosted custom recipe executes in a browser, streams a real turn, and disposes without a package install.
- Custom UIs attach one request adapter and leave every unimplemented interaction on its documented safe fallback.
