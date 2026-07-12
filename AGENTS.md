# T3 Code Ultralight Browser Fork

This repository is an embedding kit for local Codex. Keep every change small, framework-friendly, and backward-compatible with these three routes:

- isolated complete chat through `?embed=1` or `CodexChatEmbed`
- custom UI through `createCodexClient`
- existing Node server through `attachCodexBridge`

Do not add other model providers, cloud auth, database layers, Electron, or application-specific dashboard chrome. Keep the bridge loopback-only by default and never expose Codex credentials to browser code.

Before implementation, run the built `doctor --json`. Before handoff, run `npm run check` and `node tests/qa.mjs`. A successful build is not enough; verify one live local Codex turn and desktop/mobile rendering.
