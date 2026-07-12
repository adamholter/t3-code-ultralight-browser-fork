# Contributing

Keep changes aligned with the project's three public integration paths: isolated chat embed, headless browser client, and attachable Node bridge.

Before opening a pull request:

```bash
npm ci
npm run check
```

The standard check builds the publishable artifacts, creates a real tarball, installs it into a clean temporary consumer, compiles its public TypeScript API, imports every export in Node/SSR conditions, verifies the optional React boundary, and exercises the installed CLI. Do not replace it with source-only typechecking or `npm pack --dry-run`.

If local Codex is available, also run `node tests/qa.mjs`, `npm run qa:origin`, and `npm run qa:file`. The origin harness uses a temporary HTTPS certificate and headless browser to verify one exact non-loopback origin while rejecting an unlisted sibling. The file harness opens a generated recipe directly from disk and verifies the explicitly trusted opaque `null` origin. Do not add provider abstractions, cloud auth, app-specific dashboard UI, or browser-side credentials.
