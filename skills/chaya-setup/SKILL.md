---
name: chaya-setup
description: Install or repair Chaya App or local development, choose editions, or troubleshoot access and ports.
---

# Chaya: setup

Chaya manages RPG Maker games, NW.js shells, plugins, editing, translation, logs and MCP.

## Choose an edition

- **local**: App (macOS / Windows) or local dev. Full library, launch, local translation and MCP; App data uses its system app folder.
- **cloud**: `https://chaya-gray.vercel.app`. In Chrome / Microsoft Edge, grant access to a folder with `www` or `index.html`, then install plugins and shell. Launch the game yourself; the browser cannot start processes or provide local models and the local service's shared library.
- **plugin**: runs inside an open game, also without the console. External agents use its MCP for live, edit, translation, cache, logs and game skills; no library management, launch, batch or eval. Cloud fill uses `chaya_translate_job` through the connected game.

## Install App

Choose Apple silicon, Intel Mac or Windows x64 in the home page's download section.

macOS Terminal install:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

Or unpack and drag `Chaya.app` into Applications. If macOS says "damaged", run `xattr -cr /Applications/Chaya.app`, or right-click → Open → Open. On Windows, unpack and run `Chaya.exe`. The App console uses `http://127.0.0.1:3927` by default.

## Local dev

Node ≥ 22.19 and pnpm 9:

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

Open `http://localhost:3000`. `pnpm dev:lan` allows LAN access; `pnpm dev:app` includes Electron. The dev switcher selects Local / Cloud; plugins rebuild on source changes.

## Access and troubleshooting

- No sign-in. Local API accepts same-origin requests from localhost, IP addresses or `CHAYA_PUBLIC_ORIGIN`; set that variable and restart for a custom host (401).
- Game plugins use a launch token scoped to their own session. Plugin updates require a restart.
- Ports 3000 / 3927 occupied: quit other instances or set the App's `PORT`.
- Agent MCP default: `http://127.0.0.1:39271/mcp`; change the port in the in-game Integration → MCP tab and update the client address. While local runs, that gateway forwards to local MCP.
- Cloud cannot pick a folder: use desktop Chrome / Microsoft Edge and grant folder access. Launch from the installed `Chaya.app` / `Chaya` on your computer.
