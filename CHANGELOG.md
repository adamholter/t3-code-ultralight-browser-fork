# Changelog

## 0.5.0

- Add dependency-free `<codex-chat>` Web Component and auto-registration export.
- Keep custom-element imports safe during SSR and allow custom tag names.
- Add Shadow DOM styling isolation, `part="frame"`, and `codex-chat-ready`.
- Support absolute, relative, query-bearing, and hash-bearing embed URLs without browser globals.
- Add real-browser custom-element upgrade and rendering QA.

## 0.4.0

- Add one-call `chat()` for automatic thread creation or continuation.
- Add multimodal `runInput()` support for image, local-image, skill, and mention input.
- Route approval requests to the browser client that owns the active turn.
- Reject approval responses from unrelated clients and fail pending requests when their owner disconnects.
- Add real WebSocket ownership-routing tests and multimodal client tests.

## 0.3.0

- Add `t3-code-ultralight doctor` with human and JSON output.
- Add `agent-prompt` for a canonical copy-paste integration handoff.
- Harden connection, RPC, turn, child-process, and shutdown timeouts.
- Recover final assistant text from completed items when deltas are absent.
- Isolate the standalone UI from events belonging to other concurrent clients.
- Add concurrent multi-client browser regression coverage.
- Add client lifecycle and version-drift tests.

## 0.2.0

- First public ultralight release.
- Add headless client, React iframe embed, attachable Node bridge, and standalone CLI.
- Add canvas, voice, server, and agent integration documentation.
- Reduce production dependencies to `ws` only.
