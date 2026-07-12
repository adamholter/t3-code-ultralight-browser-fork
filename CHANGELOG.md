# Changelog

## 0.11.0

- Render structured network and filesystem permission requests in the complete chat.
- Show exact requested capabilities, reason, and working directory before granting.
- Add explicit turn/session grant scope and optional strict command-by-command review.
- Export framework-neutral permission parsers, descriptions, and response builders.
- Answer thread-scoped `currentTime/read` requests with schema-correct whole Unix seconds.
- Reject requests for inactive UI threads instead of leaving app-server waiting.
- Remove prompts when app-server reports that a request resolved automatically.
- Add response-shape, static-render, desktop, and mobile permission verification.

## 0.10.0

- Fail closed instead of broadcasting server requests with no identifiable live owner.
- Route legacy `conversationId` approvals through the same ownership model as modern requests.
- Reject responses with unknown, consumed, or other-client request IDs.
- Strictly validate browser `rpc`, `respond`, and `respondError` envelopes.
- Bound WebSocket payloads to 16 MiB and simultaneous RPCs to 32 per browser by default.
- Make both limits configurable for existing-server integrations and visible in standalone status.
- Handle oversized-socket errors without surfacing an uncaught process exception.
- Add real multi-client, malformed-message, concurrency-limit, and close-code verification.

## 0.9.0

- Add a versioned, lifecycle-only parent/iframe event protocol.
- Report actual bridge readiness, connection status, selected thread, turn lifecycle, and errors.
- Add typed React callbacks for every embed lifecycle event.
- Add Web Component `codex-chat-*` events and distinguish iframe load from Codex readiness.
- Export an SSR-safe raw iframe event subscriber with exact window and origin filtering.
- Exclude prompts, responses, credentials, and tool payloads from all parent events.
- Verify live ready/thread/turn delivery and forged-origin rejection in a real browser.

## 0.8.0

- Add `createCodexSession()` with remembered thread state and one-call `send()` follow-ups.
- Add turn-scoped `onDelta`, `onEvent`, `onThreadReady`, and `onTurnStarted` callbacks.
- Add `AbortSignal` cancellation plus `session.stop()` and `session.reset()`.
- Interrupt the real Codex turn before cancellation or timeout settles locally.
- Buffer early transport events until the authoritative turn ID is known.
- Prevent unrelated turn events from contaminating scoped streams.
- Update canvas and voice examples to remove manual thread bookkeeping.
- Add deterministic and real local-Codex streaming/cancellation verification.

## 0.7.0

- Add repeatable `serve --allow-origin` support for non-loopback browser hosts.
- Keep the standalone server bound to `127.0.0.1` while allowing exact browser origins only.
- Reject wildcard, malformed, credential-bearing, and path-bearing origin configuration.
- Export origin normalization helpers for existing-server integrations.
- Surface configured origins in `/api/status` and the startup receipt.
- Add real WebSocket handshake coverage for allowed, local, and rejected origins.

## 0.6.0

- Render `request_user_input` as accessible option, free-text, secret, and multi-question forms.
- Resume the same Codex turn with correctly serialized user answers.
- Add opt-in Plan-mode chat through `?mode=plan`.
- Export framework-neutral user-input and approval response helpers.
- Map both current and legacy approval response protocols correctly.
- Add `respondError()` for requests a custom host cannot safely handle.
- Verify the complete Plan-mode question and answer flow against a real local Codex.

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
