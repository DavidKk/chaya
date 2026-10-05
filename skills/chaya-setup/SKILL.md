---
name: chaya-setup
description: Chaya (RPG Maker MV/MZ toolkit) editions and installation: Edge vs local dev vs App, install steps, "damaged" app fixes. Use only when the user mentions Chaya.
---

# Chaya: what it is and how to install

Chaya is a local toolkit for RPG Maker MV / MZ games: manage a game library, give games an NW.js shell, inject in-game plugins (edit, speed-up, translation), fill translations in bulk, read logs, and expose a local MCP server so agents can drive the game directly.

## Three editions

| Edition       | What it is                                        | Can do                                                                       | Cannot do                                                                                   | Best for                     |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| **Edge**      | Web version `https://chaya-gray.vercel.app`       | After the browser is granted a game folder: write plugins and shell, get App | Launch game processes, shared translation library, local models, full MCP (live tools only) | Trying it without installing |
| **Local dev** | Source run with Node on your machine (`pnpm dev`) | Everything: library, one-click launch, translation fill, library, logs, MCP  | —                                                                                           | Developers, changing code    |
| **App**       | Desktop app (macOS / Windows)                     | Same as local dev, double-click to run, data in the system app folder        | —                                                                                           | Daily use (recommended)      |

Pick: use the **App** for everyday play and translation; **App or local dev** when an agent should control the game; **Edge** for a quick one-off plugin install.

## Install the App (recommended)

1. Open the download section on the Chaya home page and pick your machine: Apple silicon (M series), Intel Mac or Windows x64. The page marks the recommended build.
2. **macOS one-line install (recommended)** — avoids the "damaged and can't be opened" prompt. Paste into Terminal and press Return:

   ```bash
   /bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
   ```

3. macOS manual install: unzip and drag `Chaya.app` into Applications. If it says "damaged", run `xattr -cr /Applications/Chaya.app` and open it again, or right-click the app → Open → Open.
4. Windows: unzip and run `Chaya.exe`.
5. The App opens its console window at the fixed address `http://127.0.0.1:3927`.

## Install local dev

Requirements: Node ≥ 22.19, pnpm 9.

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev          # local mode, listens on localhost:3000
```

- Open `http://localhost:3000`; no sign-in needed.
- Other modes: `pnpm dev:lan` (reachable on the LAN), `pnpm dev:app` (with the Electron window, same as the App). To preview Edge behavior, pick **Edge** in the dev switcher (top right) of `pnpm dev`.
- `pnpm dev` rebuilds in-game plugins on change and the game hot-reloads.

## Use Edge

1. Open `https://chaya-gray.vercel.app` in **Chrome or Edge** (Safari / Firefox do not support folder access).
2. Go to the library, pick the local game folder (containing `www` or `index.html`) and grant read / write access.
3. The page writes plugins and the shell into the game folder; then double-click to launch the game locally (a web page cannot start processes).
4. The shared translation library, whole-game fill and other features that need local disk access are not available on Edge; use the App or local dev. Agents can still use in-game tools (live, edit catalog, translation, translation library, logs) through the game's MCP gateway `http://127.0.0.1:39271/mcp` while the game is open.

## Access and security

- Local dev and the App have no sign-in; the API only accepts same-origin requests from localhost, an IP address or `CHAYA_PUBLIC_ORIGIN`. Edge has no sign-in.
- Game plugins use a launch token generated on each launch and can only reach their own game session.

## FAQ

| Problem                         | Fix                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| macOS says the app is "damaged" | Install with the one-line command above, or run `xattr -cr /Applications/Chaya.app`                             |
| API calls return 401            | Open the console via `localhost` or an IP address; for a custom host name set `CHAYA_PUBLIC_ORIGIN` and restart |
| Port 3927 / 3000 is in use      | Quit other Chaya App / dev instances and restart (the App also accepts a `PORT` env var)                        |
| MCP port 39271 is in use        | Change it in the in-game Integration → MCP tab, then update the address in the agent                            |
| Edge cannot pick a folder       | Switch to Chrome / Edge                                                                                         |
