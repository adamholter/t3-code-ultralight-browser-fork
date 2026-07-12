# Contributing

Keep changes aligned with the project's three public integration paths: isolated chat embed, headless browser client, and attachable Node bridge.

Before opening a pull request:

```bash
npm ci
npm run check
```

If local Codex is available, also run `node tests/qa.mjs`. Do not add provider abstractions, cloud auth, app-specific dashboard UI, or browser-side credentials.
