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

Optional local simulation of edge (no Vercel account): run `pnpm dev` and pick **Edge** in the dev switcher (top right); DiskOps APIs return 501.

Edge has no sign-in and no server-side MCP. External agents connect to the unified MCP address `http://127.0.0.1:39271/mcp`, served by the open game (or the local server) — see [docs/mcp-plugin.md](docs/mcp-plugin.md) and [docs/mcp-edge.md](docs/mcp-edge.md).

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

GitHub Actions: [`.github/workflows/build-app.yml`](.github/workflows/build-app.yml) runs on `v*` tags and `workflow_dispatch`. Tag builds publish installers to a [GitHub Release](https://github.com/DavidKk/chaya/releases).

macOS builds are **ad-hoc signed** (no Apple Developer ID). After dragging **Chaya** into Applications:

1. **Right-click → Open → Open** (once). That is usually enough.
2. Only if macOS still says the app is **damaged**, run:

```bash
xattr -cr /Applications/Chaya.app
```

Windows: if SmartScreen blocks the installer, choose **More info → Run anyway**.

## Local development

Requires **Node.js ≥ 22.19** (uses `node:sqlite`) and **pnpm**.

```bash
pnpm i
pnpm dev            # local mode on localhost:3000 + plugin watch
```

Open `http://localhost:3000`. Local / App mode has no sign-in; the API only accepts same-origin requests from localhost, LAN IPs or `CHAYA_PUBLIC_ORIGIN`, and MCP needs no authorization: agents use `http://127.0.0.1:39271/mcp` (or the server's own `http://127.0.0.1:3000/api/mcp`, shown on **Integration → MCP**; the gateway port can be changed in-game).

| Command        | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `pnpm dev`     | Local console (loopback only)                    |
| `pnpm dev:lan` | Same, listen on LAN for other devices / VMs      |
| `pnpm dev:app` | Toolkit App (Next + Electron)                    |
| `pnpm ok:ci`   | Format check, lint, typecheck, tests, full build |

GitHub Actions: [CI](.github/workflows/ci.yml) runs `pnpm ok:ci` on `main` / PRs. [Build App](.github/workflows/build-app.yml) builds installers on `v*` tags (or manual dispatch) and publishes a [GitHub Release](https://github.com/DavidKk/chaya/releases) with `.dmg` / `.exe` attached.

Useful env vars:

- `CHAYA_SERVICE` — `local` \| `app` \| `vercel` (ignored when `VERCEL=1`)
- `CHAYA_AUTH_TOKEN` — internal management token for scripts and MCP self-calls; it cannot sign in a browser (otherwise auto-written under `data/access/token` for local / app)
- `CHAYA_PUBLIC_ORIGIN` — extra host name the local API accepts (e.g. a LAN domain)
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

## Disclaimer

Chaya is a neutral technical tool provided free of charge as open source. It offers only translation, editing and AI-assistance features, runs on the user’s own device (apart from third-party services the user chooses), and is not affiliated with, authorized or endorsed by Gotcha Gotcha Games, KADOKAWA Corporation or any rights holder. “RPG Maker” is a trademark of its owner and is used only to describe compatibility.

- **Lawful use.** Use Chaya only with games you have lawfully obtained and in compliance with applicable law. Where a rights holder expressly prohibits translation, modification or analysis, you shall not use Chaya on that work.
- **No distribution services.** The developers provide no distribution, hosting, upload, sharing or download service of any kind — including for game files, translation patches, translation caches, translated data files (such as JSON) and modified games. All generated data stays on your device. Any distribution is your own independent act, and you alone bear all resulting liability.
- **Third-party services.** Cloud translation and AI engines transmit game text to their providers under the providers’ own terms.
- **Editing.** Editing features may corrupt saves; back up first and do not use them online or on leaderboards.
- **No circumvention.** Chaya does not and will not decrypt protected assets, crack saves, bypass DRM or unlock paid content.
- **No warranty; user responsibility.** Chaya is provided “as is”. To the maximum extent permitted by law, the developers are not liable for any loss arising from its use, and you shall indemnify the developers against claims arising from your breach.

The full Disclaimer (EN / 中文 / 日本語 / 한국어) is available on the `/disclaimer` page of the app. Rights holders may contact the developers through GitHub Issues.

## Privacy

Chaya requires no account and the developers collect no personally identifiable information. The local edition has no telemetry and keeps settings, caches and API keys on your device. The online edition reads game folders locally in the browser, sends translation requests straight from your device to the engine you choose, and uses cookie-less Vercel Web Analytics for aggregated page visits. See the `/privacy` page for the full Privacy Policy.

## License

Chaya is an open-source project released under the [MIT License](./LICENSE): free to use, modify and redistribute, provided the copyright and permission notices are kept. The license covers this project only and grants no rights in any game, RPG Maker or third-party service; bundled third-party components keep their own licenses. See the `/license` page for details.
