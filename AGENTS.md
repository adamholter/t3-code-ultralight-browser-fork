# T3 Code Ultralight Browser Fork

This repository is an embedding kit for local Codex. Keep every change small, framework-friendly, and backward-compatible with these three routes:

- isolated complete chat through `?embed=1` or `CodexChatEmbed`
- custom canvas, voice, or bespoke UI through `createCodexAssistant`
- existing Node server through `attachCodexBridge`

Keep `integration.json` aligned with the package version and public integration behavior; it is the canonical machine-readable handoff for agents consuming this repository.

When using this repository to integrate another project, do not clone or build this source tree. Run the canonical release CLI's `agent-prompt`, then run its versioned `setup --json` command from the host project root and follow the receipt. Use `createCodexClient` directly only when the host deliberately owns threads or shares one socket across multiple assistants.

Do not add other model providers, cloud auth, database layers, Electron, or application-specific dashboard chrome. Keep the bridge loopback-only by default and never expose Codex credentials to browser code.

For repository development, run `npm ci` before the first build. Before handoff, run `npm run check` and `npm run qa:live` when local Codex is available. A successful build is not enough; verify one live local Codex turn and desktop/mobile rendering.
