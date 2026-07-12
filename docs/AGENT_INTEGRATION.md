# Agent integration contract

When a user gives you this repository and asks to let an existing tool talk to Codex:

1. Identify whether the host needs the complete chat, a custom UI, or an existing-server attachment.
2. Default to the iframe/React embed for a normal chat panel.
3. Use the headless client for canvas, voice, game, spatial, or bespoke interfaces.
4. Attach the bridge to the host's existing Node HTTP server when practical; otherwise run the included localhost service.
5. Keep the bridge bound to loopback.
6. Never copy Codex credentials, cookies, access tokens, or config secrets into the browser.
7. Preserve approval and user-input requests instead of silently accepting them.
8. Verify one real local Codex turn through the final user-facing UI.

## Minimal agent task

```text
Install https://github.com/adamholter/t3-code-ultralight-browser-fork.
Allow this web app to talk to the user's local Codex.
Use the isolated chat embed unless the existing UI needs custom rendering.
Keep the bridge localhost-only, preserve approvals, and verify one live turn.
```

## Acceptance checklist

- The host starts without manual source copying.
- The bridge reports ready.
- At least one local model is available.
- A thread can be started or resumed.
- Assistant deltas stream visibly.
- Tool activity does not crash the renderer.
- Stop and approval paths remain operable.
- No secret is present in browser storage or bundles.
- Mobile or constrained-container layout does not overflow.
