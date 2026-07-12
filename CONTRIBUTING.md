# Contributing

Keep changes aligned with the project's three public integration paths: isolated chat embed, headless browser client, and attachable Node bridge.

Before opening a pull request:

```bash
npm ci
npm run check
```

The standard check builds the publishable artifacts, creates a real tarball, installs it into a clean temporary consumer, compiles its public TypeScript API, imports every export in Node/SSR conditions, verifies the optional React boundary, and exercises the installed CLI. Do not replace it with source-only typechecking or `npm pack --dry-run`.

Install the pinned browser once with `npm run qa:install`. Run `npm run qa:markdown` after response-rendering or style changes and inspect its desktop/mobile screenshots. If local Codex is available, `npm run qa:live` builds the repository, starts and later stops only its own bridge, and runs the complete loopback, HTTPS, file-origin, fresh-workspace, rendering, and mobile story. The individual `qa:origin`, `qa:file`, and `qa:workspace` scripts remain available for focused diagnosis. No test depends on a private Codex runtime path. Do not add provider abstractions, cloud auth, app-specific dashboard UI, browser-side credentials, or a general Markdown dependency graph without explicit size and security evidence.
