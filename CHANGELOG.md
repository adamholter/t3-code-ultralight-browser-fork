# Changelog

## 0.48.0

- Propagate `--codex` from setup diagnostics into the actual background and foreground Codex app-server instead of silently falling back to the PATH default.
- Support the same `--codex` override across `setup`, `start`, `serve`, and `doctor`.
- Add a path-private Codex-binary fingerprint to browser status and require an exact binary match before reusing a bridge.
- Make deterministic automatic-port selection preserve an incompatible bridge that targets another Codex installation and choose a separate stable port.
- Search every deterministic candidate for an existing exact match before using a newly available earlier port, preventing duplicate bridges after port availability changes.
- Return the selected binary only in the trusted CLI receipt; generated browser code and browser-readable status never expose its local path.
- Add a live executable-wrapper harness that proves diagnostics and a real streamed turn use the custom binary, matching starts reuse it, mismatched starts fail closed, and the default bridge remains untouched.

## 0.47.0

- Add `createCodexAssistant()` as the smallest safe custom-interface API: one import combines stateful threads, streaming, cancellation, and a thread-scoped request adapter.
- Accept approval, user-input, permission, and MCP callbacks directly under `requestHandlers`, with documented fail-closed behavior for every omitted interaction.
- Make `await assistant.close()` interrupt an active turn, wait for its completion, detach the owned adapter, and preserve a supplied shared client.
- Publish the assistant as both `t3-code-ultralight-browser-fork/assistant` and the zero-install `/codex-assistant.js` bridge module.
- Generate custom canvas and voice recipes around the single assistant API instead of requiring two imports and manual adapter disposal.
- Verify the exact hosted generated recipe in Chromium with real streamed output, a same-thread follow-up, active-turn cancellation, thread cleanup, and one-call disposal.
- Update canvas, voice, human, agent, and machine-readable integration guidance to make the assistant the default while preserving lower-level client and request exports.

## 0.46.1

- Require the explicit repository variable `NPM_PUBLISH_ENABLED=true` in addition to `NPM_TOKEN` before the release workflow may publish to npm.
- Prevent inherited, stale, or insufficiently scoped organization credentials from failing an otherwise verified GitHub release after assets have already been rebuilt and attested.
- Keep npm failures strict once an administrator deliberately enables that secondary channel.

## 0.46.0

- Add a published-release GitHub Actions workflow that reconstructs distribution archives from the exact tag instead of trusting one developer machine.
- Require the release tag to match `package.json`, then rerun standard tests, packed-consumer checks, artifact checks, and the production dependency audit.
- Validate the exact versioned archive with `npm publish --dry-run --json`, including package identity, version, minimum file surface, and an empty bundled-dependency list.
- Create GitHub build-provenance attestations for both archives and replace the release assets with the clean-run outputs.
- Make optional npm publication idempotent and conditional on a repository `NPM_TOKEN`, while retaining GitHub archives as the canonical no-account integration path.
- Add public npm access and provenance metadata without advertising an unavailable registry package.
- Publish release-verification guarantees through `integration.json`, `llms.txt`, and the agent, integration, and contributor guides.

## 0.45.0

- Mark the published React entry with `"use client"` so server-first frameworks recognize its hook-using implementation as a client boundary.
- Add the same directive to every setup-generated React panel, making the copyable recipe safe in Next.js App Router without extra agent inference.
- Install the exact packed package into a clean Next.js 16.2.10 and React 19.2.0 App Router host.
- Import `CodexChatEmbed` directly from an unmarked Server Component, run a production build and server, and stream a real local Codex turn through the rendered frame.
- Inspect the Next.js host and embedded chat at desktop and mobile sizes with one iframe, no overflow, and empty browser console/page errors.
- Gate the built artifact on preserving the client directive instead of trusting source intent through bundling.
- Publish server-first React compatibility in the machine-readable contract and add the Next.js production host to one-command live QA.

## 0.44.0

- Install the exact packed Web Component into clean Vue 3.5.39 and Svelte 5.56.4 Vite hosts and stream a real local Codex turn through each.
- Exercise `sendPrompt()` during framework mount before the component is ready, plus `newThread()`, `stop()`, lifecycle events, unmount/remount, and thread cleanup.
- Coalesce framework-driven mount-time attribute updates so `<codex-chat>` creates one iframe and controller instead of repeatedly reloading during initial render.
- Preserve immediate controller calls by awaiting the scheduled component render before forwarding commands to the verified iframe receiver.
- Inspect desktop and mobile hosts and embedded frames for overflow while keeping browser consoles and page errors empty.
- Publish Vue/Svelte compatibility and lifecycle guarantees in the machine-readable integration contract and agent documentation.
- Add the packed framework matrix to one-command live QA and allow exact release tarballs through `QA_PACKAGE`.

## 0.43.0

- Add `--port auto` to `setup`, `start`, and `serve`, preferring port 4174 when safe and otherwise selecting a deterministic workspace-derived loopback fallback.
- Reuse a compatible version/origin/workspace bridge at the same deterministic port instead of spawning duplicates on repeated automatic setup.
- Skip incompatible Ultralight bridges and unrelated listeners without stopping or broadening them; probe up to 64 stable fallback candidates in the 42000-59999 range.
- Return the resolved numeric `port` plus `portSelection` in trusted setup/start receipts so agents can retain exact lifecycle commands.
- Make automatic selection the recommended one-link setup command while keeping running integration contracts pinned to their already-resolved port.
- Add a live two-project collision harness that occupies 4174, proves repeat reuse and workspace isolation, streams a real Codex turn, verifies runtime URLs, and stops only its two fallback bridges.

## 0.42.0

- Close attached browser sockets before stopping the Codex process so pending approvals and other owned server requests can still be rejected cleanly during teardown.
- Catch and log late request-rejection failures instead of allowing a socket close event to crash the host process.
- Bound the graceful WebSocket close handshake and terminate non-cooperative browser clients after a configurable timeout, defaulting to 1000 ms.
- Clear socket, thread-owner, and request-owner registries before final process shutdown.
- Export `DEFAULT_BROWSER_SOCKET_CLOSE_TIMEOUT_MS` and add `browserSocketCloseTimeoutMs` to the typed attached-server options.
- Stop leaking the internal `ws.WebSocketServer` declaration through the public controller type, so TypeScript server consumers no longer need an undeclared `@types/ws` package.
- Verify ordering with a pending owned approval, enforce timeout validation, and simulate a browser that deliberately stops reading before controller shutdown.
- Extend the exact packed existing-server browser harness to prove an unresponsive socket is released within its configured 80 ms test bound while host routes stay online.
- Make fresh-project QA clean its synthetic Codex threads even on render timeout and emit app-server/thread/UI diagnostics plus a failure screenshot instead of leaving opaque state behind.

## 0.41.0

- Replace the attached bridge's automatic `ws` server takeover with an exact-path `noServer` upgrade handler so unrelated host WebSocket routes are never touched.
- Remove bridge notification, request, ready, exit, and HTTP upgrade listeners during attached-controller teardown instead of retaining stale controllers in long-lived or hot-reloaded hosts.
- Make attached `stop()` idempotent, keep the host HTTP server and its own WebSockets alive, and reject restart attempts after final detach.
- Validate attached WebSocket paths as pathname-only values before registering any listener.
- Contain fire-and-forget auto-start failures as bridge log events rather than risking an unhandled rejection.
- Install the exact packed package into a temporary existing Node server that owns ordinary HTTP and WebSocket routes, then stream a real browser Codex turn through a custom nested socket path.
- Verify thread cleanup, workspace inheritance, protocol capabilities, listener release, repeated stop, restart rejection, route coexistence, and desktop/mobile output with no browser errors.

## 0.40.0

- Install the exact packed package into clean React 18.3.1 and React 19.2.0 Vite hosts instead of relying on type checks or source imports.
- Render the published `CodexChatEmbed` through `react-dom/server` and hydrate that markup in Chromium for both React generations without mismatch warnings or duplicate frames.
- Exercise React Strict Mode, ready/connection/turn callbacks, `controllerRef.sendPrompt()`, `newThread()`, `stop()`, and unmount/remount cleanup against real local Codex turns.
- Capture and inspect streamed desktop/mobile host output for both React generations while asserting that neither the host nor embedded frame overflows.
- Add a machine-readable React compatibility snapshot to `integration.json` and include the packed framework matrix in one-command live QA.
- Clean every Codex thread created by the framework matrix and keep browser consoles and page errors empty.

## 0.39.0

- Keep the resolved project directory in the trusted CLI bridge receipt while removing it from every setup-generated browser snippet.
- Make iframe controller and custom canvas/voice recipes inherit the already-verified bridge workspace instead of duplicating a machine-specific absolute path.
- Add typed `workspace` metadata to every integration recipe so agents can distinguish bridge inheritance from an intentional programmatic `cwd` override.
- Extend fresh-project live QA to execute the exact hosted custom recipe returned by `setup`, stream a real Codex turn, and prove the resulting thread still uses the correct project directory.
- Assert that the full generated integration object is path-free even when setup is invoked with a resolved workspace or explicit `--cwd` bridge override.

## 0.38.0

- Remove the developer-specific `/Users/adam` browser workspace default so a fresh clone or release works on any machine.
- Make the normalized directory where `setup`, `start`, or `serve` runs the bridge's default Codex workspace; support `--cwd` as an explicit override in every standalone lifecycle mode.
- Omit `cwd` from new browser turns until the user or host supplies one, allowing Codex to inherit the bridge workspace while showing the neutral `Bridge workspace` state.
- Remove required path placeholders from the primary custom/headless recipes; zero-option sessions now inherit the verified bridge workspace.
- Return the resolved workspace in trusted setup/start receipts while exposing only its SHA-256 fingerprint in browser-readable status.
- Require an exact workspace fingerprint for bridge reuse so two projects cannot silently share the wrong default directory.
- Add a real fresh-project browser test that runs setup from a temporary directory without `--cwd`, streams a Codex turn, confirms the resulting thread directory, checks path privacy, and inspects desktop/mobile output.
- Replace every Adam-specific Playwright resolver in QA with a pinned repository dev dependency, plus `qa:install`, focused `qa:workspace`, and one-command `qa:live` workflows.
- Wrap long unbroken user prompts inside mobile message bubbles instead of painting past their visual boundary.
- Keep the complete production chat at 94,137 decoded JavaScript plus CSS bytes, still below the enforced 110 KB ceiling.

## 0.37.0

- Add a typed, imperative controller for the complete chat so canvas, voice, and other host controls can send prompts without rebuilding T3's response UI.
- Expose `sendPrompt()`, `stop()`, and `newThread()` directly on `<codex-chat>` and through the React 18/19-compatible `CodexChatEmbedHandle` `controllerRef`.
- Serve the dependency-free raw iframe controller at `/codex-embed.js` and include its runtime-correct URL and copyable code in iframe setup receipts.
- Wait through iframe startup with a side-effect-free ping, cache the verified receiver until iframe reload, reject rapid concurrent sends synchronously, make acknowledged stop idempotent, and allow an immediate stop-to-new-thread sequence.
- Accept commands only from the exact parent window and an origin allowed by the running bridge; ignore malformed, oversized, spoofed, or unconfigured opaque-origin commands without acknowledgement.
- Allow `file:` frame ancestors only when the bridge was started with the explicit `null` origin grant, aligning CSP with the command and module policies.
- Keep prompts and responses inside the isolated chat. Host command results contain only acknowledgement state, request ID, command name, and optional thread/turn IDs.
- Keep the complete production chat at 93,880 decoded JavaScript plus CSS bytes after adding the controller, below the enforced 110 KB ceiling.
- Add live Chromium coverage for pre-ready send, streamed rendering, stop, immediate new thread, command events, and spoofed-origin rejection while preserving desktop/mobile rendering and the 110 KB app ceiling.

## 0.36.0

- Replace the ReactMarkdown, unified, micromark, mdast/hast, and remark-GFM runtime chain with a purpose-built safe React-node renderer for Codex responses.
- Reduce standalone JavaScript from 222.84 KB to 72.09 KB and total decoded JavaScript plus CSS from 240,402 bytes to 90,578 bytes, a 62% reduction.
- Lower the enforced browser-app ceiling from 260,000 to 110,000 bytes so the removed dependency graph cannot silently return.
- Preserve fenced and indented code with copy controls, inline code, headings, hard breaks, emphasis, strikethrough, safe links/autolinks, images, quotes, ordered/unordered/task lists, nesting, and aligned GFM tables.
- Render response HTML as inert text and reject unsafe link/image protocols without using `dangerouslySetInnerHTML`.
- Add malformed-entity protection plus unit coverage for common response structures and executable-markup rejection.
- Add `npm run qa:markdown` with inspected desktop/mobile screenshots, overflow assertions, rich-content counts, and browser error checks.

## 0.35.0

- Verify zero-server `file://` tools with the browser's real opaque Origin value `null`.
- Execute the exact generated hosted custom recipe from a temporary HTML file, load both browser modules with `Access-Control-Allow-Origin: null`, stream a real Codex turn, and dispose cleanly.
- Verify the file-origin WebSocket upgrade carries the trusted opaque origin and completes without browser console or page errors.
- Add typed `originPolicy.opaqueOriginAllowed` metadata so an intentional `--allow-origin null` grant cannot be confused with automatic loopback access.
- Preserve the normalized `null` allowlist in setup and recipe receipts.
- Add `npm run qa:file` and contributor guidance for repeatable installed-artifact verification.

## 0.34.0

- Add an executable HTTPS non-loopback browser-origin harness for the zero-install hosted recipe.
- Verify an exact configured origin receives matching CORS headers, opens the browser WebSocket, streams a real Codex turn, and disposes cleanly.
- Verify an unlisted sibling origin is rejected independently by both hosted-module HTTP routing and the WebSocket upgrade.
- Exercise the secure-page-to-loopback HTTP and `ws://127.0.0.1` boundary under a restrictive generated CSP with no console or page errors.
- Include a typed `originPolicy` in every integration recipe with automatic loopback behavior, deduplicated additional origins, and the exact non-loopback setup flag.
- Pass setup's normalized allowlist into the generated recipe so the integration object is self-contained instead of relying on a sibling bridge receipt.
- Add `npm run qa:origin` and contributor guidance for repeating the live security boundary test.

## 0.33.0

- Make a real fresh-packed-consumer test a required part of `npm run check` and GitHub CI.
- Build the current source before packing so standalone `check:packed` cannot validate stale distribution files.
- Install the tarball into an isolated temporary project and compile its public TypeScript API with strict NodeNext resolution and dependency checking.
- Import every declared package export at runtime and fail when the export map grows without matching consumer coverage.
- Prove headless, server, Web Component, request, doctor, and integration exports load with React absent, then separately verify the optional React peer path.
- Exercise the installed CLI help and packaged integration contract instead of trusting source entrypoints or `npm pack --dry-run`.
- Clean every temporary tarball and consumer installation after the gate.

## 0.32.0

- Add `--delivery package|hosted` to setup recipes for Web Component and custom canvas, voice, or bespoke interfaces.
- Generate zero-install hosted recipes that import the live `/codex-chat.js`, `/codex-client.js`, and `/codex-requests.js` modules directly.
- Keep iframe delivery hosted and React delivery package-only, rejecting invalid combinations before diagnostics or process startup.
- Include a `delivery` discriminator, `codeLanguage`, and exact CSP source additions in every typed recipe.
- Preserve strongly narrowed TypeScript results for explicit hosted and package recipe calls.
- Add an end-to-end browser harness that executes the exact generated hosted custom recipe, streams a real Codex response, and verifies cleanup without npm or copied artifacts.

## 0.31.0

- Add `setup --mode iframe|react|element|custom --json` to combine read-only Codex diagnostics, safe background bridge startup, and a complete copyable host recipe.
- Return nonzero machine-readable setup failures without starting or changing a bridge.
- Include exact versioned install commands, runtime URLs, code, cleanup guidance, and verification endpoints in setup receipts.
- Materialize `/api/integration` and `/integration.json` from the actual standalone port instead of incorrectly retaining port 4174 URLs.
- Rewrite live status, stop, foreground, start, setup, iframe, Web Component, client, and request-module addresses together.
- Export typed contract and recipe builders from `t3-code-ultralight-browser-fork/integration` for installer authors.
- Add unit and live alternate-port assertions covering contracts, recipes, CLI validation, failure side effects, and runtime URL consistency.

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
