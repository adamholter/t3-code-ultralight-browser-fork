# Contributing

Keep changes aligned with the project's three public integration paths: isolated chat embed, headless browser client, and attachable Node bridge.

Before opening a pull request:

```bash
npm ci
npm run check
```

The standard check builds the publishable artifacts, creates a real tarball, installs it into a clean temporary consumer, compiles its public TypeScript API, imports every export in Node/SSR conditions, verifies the optional React boundary, and exercises the installed CLI. Do not replace it with source-only typechecking or `npm pack --dry-run`.

Install the pinned browser once with `npm run qa:install`. Run `npm run qa:markdown` after response-rendering or style changes and inspect its desktop/mobile screenshots. If local Codex is available, `npm run qa:live` builds the repository, starts and later stops only its own bridge, and runs the complete loopback, deterministic multi-project auto-port, HTTPS, file-origin, fresh-workspace, packed React 18/19, packed Next.js 16 App Router, packed Vue 3/Svelte 5, attached-server, rendering, and mobile story. Use `npm run qa:auto-port` for the focused collision/repeatability proof, `npm run qa:react` for the isolated packed React/SSR matrix, `npm run qa:next` for the server-first React production host, `npm run qa:frameworks` for the packed Web Component framework matrix, and `npm run qa:attached` for exact-path existing-server coexistence and lifecycle verification. The individual `qa:origin`, `qa:file`, and `qa:workspace` scripts remain available for focused diagnosis. Set `QA_PACKAGE=/absolute/path/to/release.tgz` when running `node tests/auto-port-qa.mjs`, `node tests/workspace-qa.mjs`, `node tests/react-host-qa.mjs`, `node tests/next-host-qa.mjs`, `node tests/framework-host-qa.mjs`, or `node tests/attached-server-qa.mjs` to repeat those live proofs through an exact packed release instead of a temporary workspace pack. No test depends on a private Codex runtime path. Do not add provider abstractions, cloud auth, app-specific dashboard UI, browser-side credentials, or a general Markdown dependency graph without explicit size and security evidence.

Publishing a GitHub release triggers `.github/workflows/release.yml`. The workflow requires the tag to equal `v` plus `package.json` version, rebuilds and validates the archives from a clean checkout, performs an npm publish dry run, attests their provenance, and replaces both release assets. It publishes to npm only when the repository has an `NPM_TOKEN`; reruns skip a version already present in the registry. Keep GitHub assets canonical so contributors do not need npm credentials to release or consume the project.
