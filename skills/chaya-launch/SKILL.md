---
name: chaya-launch
description: How to add a game in Chaya, install the shell, inject plugins, launch the game, and use edit / translation / logs. Use when the user asks how to start a game, why plugins do not work, or how to translate / change gold.
---

# Chaya: add a game and launch it

## 1. Add a game

- **App / local dev**: console → Library → choose a game. You can pick the `www` folder, a release folder containing `www`, or an NW.js package (the folder with macOS `.app` / Windows `Game.exe`). Chaya detects the MV / MZ content root and adds it to the library.
- **Edge**: in Chrome / Edge, pick a folder containing `www` or `index.html` and grant read / write access.
- Library entries can be annotated, switched and removed (removing only drops the record, never the game files).

## 2. Install the shell (NW.js)

RPG Maker games run on NW.js. Chaya uses one shared shell:

- Click "Install shell" in the library details; by default it downloads the latest stable build for your platform from nwjs.io (about 100 MB). Packaged games that ship their own shell need nothing.
- **macOS shell will not start**: quit the game, run the command below in Terminal, follow the 6-step prompts to pick the game folder, and double-click `Chaya.app` once you see "✓ Installed":

  ```bash
  /bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
  ```

  Saves are kept and the old shell is backed up automatically.

## 3. Plugins

Chaya injects plugins automatically on launch; you can also "Install / Clear plugins" in the library.

| Plugin        | Purpose                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `ChayaLoader` | Thin loader: pulls plugins from the local Chaya, falls back to the disk cache offline            |
| `ChayaLog`    | Plugin runtime and log reporting                                                                 |
| `ChayaTrans`  | In-game translation: pretranslated cache / realtime local model / subtitles                      |
| `ChayaBoost`  | Movement speed-up: `ChayaBoost.on()` / `off()`                                                   |
| `ChayaEdit`   | Live edits: gold, items, variables, switches, actors, teleport, save / load (`ChayaEdit.help()`) |
| `ChayaAgent`  | Agent bridge: the local MCP controls the game through it                                         |

Restart the game after updating plugins; older games need plugins reinstalled once before new plugins load.

## 4. Launch and quit

- **App / local dev**: click "Launch" in the library. Chaya writes the launch config (including this launch's token) and opens the game; the console and game connect directly over WebRTC and the top bar shows the online status.
- Quit: click "Quit game" in the console, or just close the game window.
- **Edge**: once the page has written plugins and the shell, double-click `Chaya.app` / `Chaya` next to the game folder to launch.

## 5. Edit (/cheat)

With the game online, open the Edit page: change gold, item / weapon / armor counts, variables, switches and actor stats, toggle god mode, walk-through-walls and speed-up, teleport, and save / load. The same panel also opens in game via a hotkey.

## 6. Translation (/translate)

1. **Extract**: pull source text from the game data to build the seed.
2. **Fill**: start the whole-game fill job; it fills missing entries in engine order (default Ollama → Bing → Google) and can be paused at any time.
3. **Library**: browse, search, edit, delete and import shared translations (shared by all games).
4. **In-game mode**: pretranslated (cache only), realtime (local model translates dialogue), or subtitles.

## 7. Logs (/logs)

Plugin and server logs are collected on the Logs page and can be filtered by source and level; check here first for plugin errors, translation failures and connection problems.

## Troubleshooting

| Symptom                            | Check                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Launch says the shell is missing   | Install the shell first                                                        |
| Plugins have no effect             | Reinstall plugins and restart the game; check `ChayaLoader` errors in the logs |
| The console shows the game offline | Make sure the game was launched from Chaya; refresh the console                |
| A macOS game will not open         | Run the macOS shell repair command above                                       |
