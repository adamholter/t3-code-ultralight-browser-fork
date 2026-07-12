# Agent integration contract

When a user gives you this repository and asks to let an existing tool talk to Codex:

1. Identify whether the host needs the complete chat, a custom UI, or an existing-server attachment.
2. Install the package and run `npx t3-code-ultralight doctor --json` before modifying the host.
3. Resolve every failed doctor check or report its exact recommendation.
4. Use the Web Component for a normal non-React chat panel and the React wrapper in React hosts.
   Wire the host's loading, connection, and busy states to the provided embed lifecycle events instead of probing iframe DOM.
5. Use `createCodexSession()` for a normal canvas, voice, game, spatial, or bespoke interface; use the lower-level client only when the host manages threads or shares a socket.
6. Attach the bridge to the host's existing Node HTTP server when practical; otherwise run the included localhost service.
7. Keep the bridge bound to loopback.
8. If a headless browser client is not served from loopback, allow only its exact browser origin with `--allow-origin` or `allowedOrigins`; never use a wildcard.
9. Never copy Codex credentials, cookies, access tokens, or config secrets into the browser.
10. Preserve approval and user-input requests instead of silently accepting them.
11. Verify one real local Codex turn through the final user-facing UI.

## Minimal agent task

```text
Install https://github.com/adamholter/t3-code-ultralight-browser-fork.
Allow this web app to talk to the user's local Codex.
Run the package doctor first. Use the isolated chat embed unless the existing UI needs custom rendering.
Keep the bridge localhost-only, preserve approvals, and verify one live turn.
```

## Acceptance checklist

- The host starts without manual source copying.
- `doctor --json` reports `ok: true`.
- The bridge reports ready.
- At least one local model is available.
- A thread can be started or resumed.
- Assistant deltas stream visibly.
- Tool activity does not crash the renderer.
- Stop and approval paths remain operable.
- Custom sessions retain their thread, scope streamed events, and interrupt Codex when stopped.
- No secret is present in browser storage or bundles.
- Non-loopback browser origins are explicit and exact; unlisted origins are rejected.
- Mobile or constrained-container layout does not overflow.
- Embedded hosts receive ready and turn lifecycle events only from the expected iframe origin.
