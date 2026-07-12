# Codex Web

A deliberately small, local-first web client for Codex. It keeps the interaction details that matter from T3 Code—fast streaming, readable tool activity, a strong composer, responsive threads, and polished message rendering—without the multi-provider and multi-platform architecture.

## What it keeps

- Local Codex authentication, config, models, skills, MCP tools, and thread history
- New and existing threads
- Streaming assistant, reasoning, command, file, and tool activity
- Model and reasoning selection
- Working-directory selection
- Stop and approval controls
- Desktop and mobile layouts, light and dark themes

## What it removes

- Claude Code, OpenCode, Cursor, and custom provider layers
- Electron, Expo/mobile-native, marketing, auth, remote sync, SSH, and Tailscale
- Collaboration, multi-environment orchestration, database projections, and provider registries
- Settings surfaces unrelated to talking to local Codex

## Run

Requirements: Node 22+ and a working `codex` CLI login.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

For a production build:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:4174`.

## Architecture

The browser never receives Codex credentials. A small Node bridge binds to localhost, launches `codex app-server --stdio`, and forwards a narrow JSON-RPC event stream over a local WebSocket. The React client renders that stream directly.

The source is intentionally compact so this repository can serve as the baseline for future Codex-backed interfaces.

## Attribution

This project is derived from the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) interface and retains its license.
