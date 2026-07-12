# Changelog

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
