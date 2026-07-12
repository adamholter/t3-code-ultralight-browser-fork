# Changelog

## 0.30.0

- Export `CodexClientEventMap` with inferred payloads for stable connection, bridge, request, turn, item, delta, lifecycle, and error events.
- Reject incompatible handlers for known literal event names at TypeScript compile time.
- Preserve a string-event `any` escape hatch for newly introduced Codex protocol notifications.
- Type model and thread catalogs returned by `listModels()` and `listThreads()`.
- Type the stable final turn envelope returned by chat, input, turn, and session calls.
- Add compile-only consumer contracts covering known events, future events, catalogs, requests, and invalid callbacks.

## 0.29.0

- Reject unknown CLI commands instead of printing successful help output.
- Reject typoed options, stray positional values, duplicate singleton flags, and accidental values after booleans.
- Validate the complete command shape before any status probe, child spawn, stop signal, or doctor process.
- Preserve explicit `help`, `--help`, and `-h` zero-exit behavior.
- Keep `--allow-origin` intentionally repeatable while deduplicating its normalized values.
- Add no-side-effect validation for misspelled start flags and comprehensive agent-command error coverage.
- Keep the bundled standalone UI connected to its serving origin on arbitrary `--port` values while exported headless clients retain the standard port-4174 default.
- Add a CI configuration guard and live alternate-port browser, embed, Web Component, CSP, and performance verification.

## 0.28.0

- Require an exact allowed-origin set when reusing an existing standalone bridge.
- Prevent loopback-only tools from silently inheriting another tool's broader browser allowlist.
- Add explicit `--reuse-origin-superset` for hosts that intentionally accept every configured extra origin.
- Report `extraAllowedOrigins` and `originSupersetAccepted` in machine-readable start receipts.
- Deduplicate repeated origin arguments before comparison and child startup.
- Add exact-match, fail-closed subset, explicit-superset, and packaged CLI verification.

## 0.27.0

- Remove the user's home/working path from standalone status metadata.
- Mark HTML and JSON metadata `no-store` so bridge upgrades cannot retain an old application shell.
- Cache content-hashed JavaScript and CSS immutably for fast repeat loads.
- Return an explicit 404 for missing or stale asset filenames instead of serving HTML as JavaScript.
- Add nosniff, no-referrer, and restrictive content-security headers while preserving supported cross-origin iframe embedding.
- Add browser assertions for CSP compatibility, cache behavior, stale assets, metadata privacy, and security headers.

## 0.26.0

- Add `attachCodexSessionRequestHandlers()` for independent prompt surfaces sharing one client socket.
- Scope approvals, questions, permissions, MCP elicitations, time, and fallback handling to each session's dynamic current thread.
- Add an optional request predicate to the global adapter for other ownership models.
- Preserve the existing one-global-adapter API for hosts that intentionally centralize prompts.
- Verify two simultaneous sessions stream isolated responses over one WebSocket, survive sibling disposal, and leave their shared client usable.
- Add deterministic dynamic-thread and legacy-conversation routing tests plus live session-scoped question verification.

## 0.25.0

- Add a versioned `integration.json` machine contract for one-link agent handoffs.
- Describe requirements, cache-safe release commands, bridge lifecycle, all three integration modes, package exports, security invariants, and acceptance checks without prose scraping.
- Add `llms.txt` discovery pointers for agent-friendly repository navigation.
- Ship both files in the consumer tarball and expose the identical contract through `t3-code-ultralight integration`.
- Serve the contract from `/api/integration` and `/integration.json` on every running standalone bridge.
- Add version/cache-key drift gates, schema-shape checks, CLI coverage, and packaged endpoint verification.

## 0.24.0

- Make `CodexSession.close()` idempotent and return a completion promise for reliable host disposal.
- Keep the owned socket open until an active `turn/interrupt` request is acknowledged, preventing invisible work after UI unmount.
- Permanently reject sends and resets after close instead of silently reconnecting a disposed session.
- Preserve supplied shared clients while still cancelling and settling the closing session's active turn.
- Expose `session.closed` for host lifecycle state.
- Add deterministic delayed-interrupt, repeated-close, post-close, and shared-client coverage plus live close-during-turn verification.

## 0.23.0

- Make the headless client connect to the standard port-4174 standalone bridge with no URL configuration.
- Add `bridgeUrl` for alternate standalone HTTP(S) origins and derive the secure `/ws` endpoint automatically.
- Preserve exact raw `url` control for attached servers and custom WebSocket paths.
- Export `DEFAULT_CODEX_BRIDGE_URL` and `codexBridgeWebSocketUrl()` for host coordination.
- Reject ambiguous bridge paths, credentials, queries, fragments, and non-HTTP protocols before opening a socket.
- Add live zero-config Node/SSR and cross-port browser verification, including DOM-free React and Web Component imports.
- Remove manual WebSocket URLs from the canvas, voice, shared-client, and integration examples.
- Declare React 18/19 as an optional peer so headless installs stay minimal and wrapper consumers receive an explicit runtime contract.

## 0.22.0

- Add `start` for background bridge startup with deterministic Codex readiness.
- Return stable human or JSON receipts with URL, version, PID, origins, reuse state, and a private temporary log path.
- Reuse compatible bridges without spawning another process.
- Capture detached startup diagnostics and surface exact port or boot failures instead of ambiguous timeouts.
- Keep `serve` as the explicit foreground mode and integrate background processes with the existing safe `status` and `stop` lifecycle.
- Make background startup the default human and agent integration recipe.

## 0.21.1

- Cache-key the mutable latest-release URL with the package version so npm and npx cannot silently reuse an older bridge release.
- Add a version-alignment gate that fails when public install commands are not advanced with the package.
- Explain the cache key in both human and agent integration instructions.

## 0.21.0

- Add an idempotent `stop` command for clean upgrades and allowed-origin changes.
- Validate the bridge service identity and reported PID before sending `SIGTERM`, then wait for confirmed shutdown.
- Refuse to signal unrelated listeners and return stable human or JSON receipts when the bridge is already stopped.
- Point version and origin conflicts at the exact recovery command.
- Document the existing one-command, install-free chat path through the stable release tarball.
- Add clean child-process shutdown, repeated-stop, unrelated-listener, and recovery-message coverage.

## 0.20.0

- Remove the redundant `thread/resume` RPC from healthy `CodexSession` follow-up turns.
- Resume an existing thread once on first use, after an explicit reset, or after bridge/app-server reconnection.
- Keep the one-shot `CodexClient.chat()` behavior unchanged while exposing an opt-out for callers that already loaded a thread.
- Strip the local-only resume option before sending turn parameters to Codex.
- Add deterministic RPC-count tests and live session QA that proves zero redundant resumes.

## 0.19.0

- Add `attachCodexRequestHandlers()` as one typed subscription for custom interfaces.
- Dispatch approvals, user questions, structured permissions, MCP forms/URLs, current time, and custom requests through schema-correct handlers.
- Fail closed without stalling when a handler is absent: decline approvals/MCP, skip questions, reject permissions, and error on unknown interactions.
- Contain handler and error-reporter failures without creating unhandled rejections after socket closure.
- Export `handleCodexServerRequest()` for one-off dispatch and direct tests.
- Serve the self-contained adapter at `/codex-requests.js` for no-bundler canvas and voice UIs.
- Add deterministic response-shape, missing-handler, exception, unsubscribe, browser-module, and live Plan-question verification.

## 0.18.0

- Serve self-contained `/codex-chat.js` and `/codex-client.js` modules from the standalone bridge.
- Let plain HTML embed the complete chat or headless client without a bundler, copied files, or package imports.
- Apply the WebSocket exact-origin policy to hosted modules with origin-scoped CORS.
- Add no-store, nosniff, and explicit cross-origin resource policy headers.
- Advertise hosted modules through protocol `1.1`, the `hostedModules` capability, and standalone status.
- Disable autofocus only inside embeds to avoid blocked cross-origin focus attempts and console errors.
- Add strict-CSP, desktop/mobile, lifecycle, headless, CORS-header, overflow, and denied-origin Chromium verification.
- Add an artifact gate that keeps both hosted modules self-contained.

## 0.17.0

- Add a `1.0` browser protocol hello before the existing bridge status envelope.
- Advertise bridge version, active transport limits, and RPC, server-request, ownership, isolation, and limit capabilities.
- Delay client readiness until protocol negotiation succeeds instead of treating a bare socket open as ready.
- Reject incompatible protocol majors, malformed hello payloads, and missing caller-required capabilities immediately.
- Preserve compatibility with older bridges that begin with the legacy status envelope.
- Export protocol constants, capability names, and negotiated `bridgeInfo` for custom hosts.
- Include protocol and capabilities in standalone JSON status output and verify negotiation against live and packed bridges.

## 0.16.0

- Make `serve` idempotent when an identical standalone bridge is already running.
- Reject existing-bridge version and requested-origin mismatches before touching Codex.
- Add human and JSON `status` commands that report URL, readiness, version, PID, and allowed origins.
- Add stable service identity, PID, WebSocket path, and no-store headers to `/api/status`.
- Validate ports before startup and replace unrelated port-collision stack traces with an actionable one-line error.
- Bind the loopback HTTP server before starting app-server so port failures stay cheap and side-effect free.
- Add mocked CLI coverage plus real process reuse, mismatch, offline, metadata, and collision verification.

## 0.15.0

- Route every thread-scoped Codex notification only to the browser that owns that thread.
- Drop unowned thread notifications instead of leaking them to unrelated local tools.
- Continue broadcasting only genuinely unscoped bridge lifecycle notifications.
- Contain failed automatic reconnect attempts and expose them through `reconnectError` without unhandled promise rejections.
- Return malformed WebSocket construction as a normal rejected `connect()` promise.
- Surface initial and retry connection failures in the complete chat without leaving stale errors after recovery.
- Verify notification privacy with deterministic sockets and a passive second client against the live Codex bridge.

## 0.14.0

- Run the bundled standalone chat on Preact's React-compatible runtime.
- Keep the exported React wrapper and React-focused tests on real React.
- Reduce standalone JavaScript from 394.8 KB to 219.5 KB and gzip size from 122.4 KB to 69.2 KB.
- Enforce a 260 KB combined JavaScript/CSS artifact budget.
- Add real-browser startup, asset-count, asset-size, font-request, and console-error performance QA.
- Verify both production and Vite development paths against the local Codex bridge.

## 0.13.0

- Add a stable `releases/latest/download` package URL for build-free consumer installs.
- Add a deterministic release packager that emits versioned and stable asset names.
- Replace bundled webfonts with native system sans and monospace stacks.
- Omit library sourcemaps from the consumer artifact while retaining public source on GitHub.
- Reduce both first-load assets and the install tarball without changing the integration API.
- Add an artifact regression gate that rejects bundled fonts, library maps, and extra app entry assets.

## 0.12.0

- Render MCP `form` and `openai/form` primitive object schemas in the complete chat.
- Support text formats, number/integer constraints, booleans, single-selects, and multi-selects.
- Apply defaults and required/min/max constraints before enabling submission.
- Render MCP URL elicitations as explicit credential-free HTTP(S) authorization flows.
- Return typed MCP content with schema-correct accept, decline, and cancel responses.
- Export framework-neutral elicitation parsers, defaults, validation, and response builders.
- Fail closed on nested, unknown, unsafe, or contradictory schema shapes.
- Add parser, static-render, desktop, and mobile Chromium form/URL verification.

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
