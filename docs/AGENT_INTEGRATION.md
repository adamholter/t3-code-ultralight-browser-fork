# Agent integration contract

When a user gives you this repository and asks to let an existing tool talk to Codex:

1. Identify whether the host needs the complete chat, a custom UI, or an existing-server attachment.
2. Install the package and run `npx t3-code-ultralight doctor --json` before modifying the host.
3. Resolve every failed doctor check or report its exact recommendation.
4. Use the Web Component for a normal non-React chat panel and the React wrapper in React hosts.
5. Use the headless client for canvas, voice, game, spatial, or bespoke interfaces.
6. Attach the bridge to the host's existing Node HTTP server when practical; otherwise run the included localhost service.
7. Keep the bridge bound to loopback.
8. Never copy Codex credentials, cookies, access tokens, or config secrets into the browser.
9. Preserve approval and user-input requests instead of silently accepting them.
10. Verify one real local Codex turn through the final user-facing UI.

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
- No secret is present in browser storage or bundles.
- Mobile or constrained-container layout does not overflow.
