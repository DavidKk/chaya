[![Chinese docs](https://img.shields.io/badge/docs-Chinese-green?style=flat-square&logo=docs)](https://github.com/DavidKk/chaya/blob/main/README.zh-CN.md) [![English](https://img.shields.io/badge/docs-English-green?style=flat-square&logo=docs)](https://github.com/DavidKk/chaya/blob/main/README.md) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/)

# Chaya

Chaya is a local-first toolkit for **RPG Maker** games: translation (extract, seed, live / subtitle), in-game edits (gold, items, variables, actors), and a shared NW.js shell for launch — with the same console and in-game plugins.

It runs in three modes:

| Mode            | How                                                     | Disk access                                                             |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Local**       | Node next to your game folders                          | Full (bind, shell, plugins, cache)                                      |
| **Toolkit App** | Electron + Next (`CHAYA_SERVICE=app`)                   | Full                                                                    |
| **Edge**        | Vercel / browser (`VERCEL=1` or `CHAYA_SERVICE=vercel`) | No server disk — prepare games in Chrome via the File System Access API |

Inspired by the MagickMonkey / [vercel-web-scripts](https://github.com/DavidKk/vercel-web-scripts) layout: Next.js UI + `plugins/` game scripts.

## Features

- **Game library** — Bind multiple titles, track shell / plugins / window settings.
- **Translation pipeline** — Extract, fill missing lines, shared cache; live or subtitle translation while playing.
- **In-game edit** — Gold, items, variables, actors / skills; hotkeys and run toggles; console and overlay stay in sync.
- **Local data** — Translations and toolkit state stay on your machine in local / app mode (not on the Edge server).

## Deploy to Vercel (Edge)

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDavidKk%2Fchaya)

On Vercel, `VERCEL=1` forces **edge** mode: the marketing / console UI is served from the cloud; installing shells and writing into game trees happens in the **browser** (Chromium + directory picker), not on the server.

1. Import [DavidKk/chaya](https://github.com/DavidKk/chaya) into Vercel (or use the button above).
2. Framework preset: **Next.js**. Build command: `pnpm build` (runs `build:plugins` then `next build`).
3. Deploy. Open the deployment URL — `/` shows the product page; **Open console** goes to `/game`.
4. Use Chrome / Edge on the client machine to grant folder access and prepare games.

Optional local simulation of edge (no Vercel account):

```bash
pnpm i
pnpm dev:edge   # CHAYA_SERVICE=vercel — DiskOps APIs return 501
```

## Build the app

Desktop toolkit shell (Electron) + Next in **app** mode:

```bash
pnpm i
pnpm build          # plugins → plugins/dist, then next build
pnpm start          # serve the production Next app on 127.0.0.1:3927
pnpm electron:open  # open Electron against that server (CHAYA_SERVICE=app)
```

Day-to-day desktop development (Next + plugin watch + Electron together):

```bash
pnpm dev:app
```

Packaged installers are built with electron-builder:

```bash
pnpm dist:mac   # .dmg (x64 + arm64)
pnpm dist:win   # NSIS .exe (x64)
```

GitHub Actions: [`.github/workflows/build-app.yml`](.github/workflows/build-app.yml) runs on `v*` tags and `workflow_dispatch`, uploading artifacts under `release/`.

## Local development

Requires **Node.js ≥ 22.19** (uses `node:sqlite`) and **pnpm**.

```bash
pnpm i
pnpm dev            # local mode on 127.0.0.1:3927 + plugin watch
```

Open the **auth link** printed in the terminal (HttpOnly session). Do not share that link.

| Command         | Purpose                                          |
| --------------- | ------------------------------------------------ |
| `pnpm dev`      | Local console (loopback only)                    |
| `pnpm dev:lan`  | Same, listen on LAN for other devices / VMs      |
| `pnpm dev:app`  | Toolkit App (Next + Electron)                    |
| `pnpm dev:edge` | Edge mode locally                                |
| `pnpm ok:ci`    | Format check, lint, typecheck, tests, full build |

GitHub Actions: [CI](.github/workflows/ci.yml) runs `pnpm ok:ci` on `main` / PRs; [Build App](.github/workflows/build-app.yml) builds installers on `v*` tags or manual dispatch.

Useful env vars:

- `CHAYA_SERVICE` — `local` \| `app` \| `vercel` (ignored when `VERCEL=1`)
- `CHAYA_AUTH_TOKEN` — management token (otherwise auto-written under `data/access/token` for local / app)
- `CHAYA_API_LAN=1` — advertise LAN API base for in-game plugins

After launch, plugins write `js/plugins/ChayaEnv.js` and heartbeat to `/api/runtime/heartbeat`. Restart the game from the console after upgrading plugins.

## Project layout

```text
chaya/
  app/ components/ lib/   Next UI & shared helpers
  services/               game / runtime / translate / extract / log
  plugins/                in-game scripts (Vite IIFE → plugins/dist)
  electron/               Toolkit App main process
  data/                   local toolkit data (gitignored)
```

## License

[MIT](./LICENSE)
