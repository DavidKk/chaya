---
name: chaya-launch
description: Prepare or launch a Chaya game, install or repair its NW.js shell and plugins. Skip ordinary in-game MCP actions.
---

# Chaya: prepare and launch a game

## Prepare

1. **local** (App / local dev): Library → choose `www`, its parent release folder, or a package containing macOS `.app` / Windows `Game.exe`. Chaya detects the MV / MZ content root. Library removal deletes only the record.
2. **cloud**: in Chrome / Microsoft Edge, grant read / write access to a folder containing `www` or `index.html`.
3. Install the shared NW.js shell from library details (about 100 MB); a game with its own shell needs no extra shell.
4. Install plugins, then restart the game after every plugin update. Local launch also injects plugins automatically.

If the macOS shell will not open, quit the game and run this in Terminal; follow the folder prompts, then open `Chaya.app`. Saves are kept and the old shell is backed up:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## Plugin roles

- `ChayaLoader`: loader with disk-cache fallback; `ChayaLog`: runtime logs.
- `ChayaTrans`: translation; `ChayaBoost`: speed (`on()` / `off()`).
- `ChayaEdit`: edits, teleport, save / load (`help()`); `ChayaAgent`: game control bridge.

## Launch and use

- **local**: Library → Launch writes the session config and opens the game. The plugin connects to the local service; the console shows online status.
- **cloud**: after preparation, double-click `Chaya.app` / `Chaya` beside the game folder. Game communication uses WebRTC; a web page cannot launch processes.
- Edit (`/cheat`): gold, items, switches, variables, actors, god mode, walk-through, speed, teleport and save / load. The game hotkey opens the same panel.
- Translate (`/translate`): extract source seed → start the whole-game fill job using enabled engines and scheduler settings; pause when needed. Browse, search, edit, delete or import cache entries. In-game modes: pretranslated, realtime, subtitles. Cloud jobs use the connected game; the local shared library requires local service.
- Logs (`/logs`): filter plugin / server logs by source and level; inspect failures here.
- Quit from the console or close the game window. Ask before destructive edits, plugin clearing, save-slot overwrites, loading or quitting on the user's behalf.

## Troubleshooting

Missing shell: install it. Inactive plugins: reinstall and restart, then inspect `ChayaLoader` logs. Offline: verify `ChayaAgent` loaded and its connection config, then refresh the console. On macOS, use the repair command above if needed.
