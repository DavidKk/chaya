---
name: chaya-mcp
description: Operate Chaya through its MCP server (chaya_* tools): library, launch, live edits, translation, logs. Use only when the user asks the agent to drive Chaya or a Chaya-enabled game.
---

# Chaya MCP: let the agent control the game

## Prerequisites

- **Local MCP** (App / local dev): `http://127.0.0.1:3000/api/mcp` (App `3927`), shown on the console's Integrations → MCP page. All tools, including library / game / edit / translate / cache / logs and `eval`.
- **Plugin MCP** (game opened from the Edge web version with plugins installed): `http://127.0.0.1:39271/mcp` (default port; if changed, use the address on the in-game **Integration → MCP** tab). Game ops (state, recent story, screenshot, keys, tap, walk, quit), edit, translation (no batch), translation library, logs and plugin tools — no library / current-game management and no `eval`. While the App / local dev runs, this address forwards to the local MCP.
- The Edge web version itself has no MCP server; if neither runs, the connection fails until one is opened.
- Live tools (`chaya_live_*`) need the game **launched from Chaya** with the `ChayaAgent` plugin loaded; for older games run `chaya_game_plugins_install` and restart first.

## Connect

- Auth: none. The gateway only listens on `127.0.0.1` and needs no token; clients get every available tool as soon as they connect.
- Cursor `~/.cursor/mcp.json`:

  ```json
  {
    "mcpServers": {
      "chaya": { "url": "http://127.0.0.1:39271/mcp" }
    }
  }
  ```

- Claude Code: `claude mcp add --transport http --scope user chaya http://127.0.0.1:39271/mcp`
- Codex: `codex mcp add chaya --url http://127.0.0.1:39271/mcp`

## Tool groups

| Group               | Tools                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Library             | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                            |
| Current game        | `chaya_game_status` / `launch` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                                          |
| Live game           | Game ops: `chaya_live_games` / `state` / `history` / `screenshot` / `press` / `play` / `tap` / `move_to` / `quit` (`eval` is off by default); plugin tools: `plugins` / `call` |
| Edit                | `chaya_edit_catalog` / `state` / `set` / `action` (the in-game edit page)                                                                                                      |
| Translation         | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                             |
| Translation library | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                                           |
| Logs                | `chaya_logs_query` / `clear`                                                                                                                                                   |
| Plugin tools        | `chaya_plugin_boost_*` (on / off / status), `chaya_plugin_trans_*` (status / reload) — only while a game is online                                                             |

Full parameters are on the console's Integrations → MCP page or in `tools/list`. Plugin tools can also be called through `chaya_live_call {plugin, tool, input}`; `chaya_live_plugins` lists the tools each plugin declares. Agents never change game data directly: edits go through the edit page presets (`chaya_edit_*`).

## Standard workflow

1. **Read state**: `chaya_game_status` (binding, shell, plugins, online); use `chaya_live_state` while the game runs.
2. **Look up ids**: `chaya_edit_catalog` (e.g. `kind=items, q=ポーション`).
3. **Act**: `chaya_edit_set` / `chaya_edit_action` / `chaya_live_press` / `chaya_live_tap` / translation or library tools.
4. **Confirm**: read the state or logs again and report the before / after to the user.

## Recipes

| Goal                        | Calls                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Set gold to 99999           | `chaya_edit_set {op:"gold", value:99999}`                                                                                              |
| Give 10 of an item          | `chaya_edit_catalog {kind:"items", q:"potion"}` → `chaya_edit_set {op:"count", kind:"item", id, value:10}`                             |
| Actor 1 HP to 999           | `chaya_edit_set {op:"actor", id:1, patch:{hp:999}}`                                                                                    |
| God mode / walk-through     | `chaya_edit_set {op:"runFlag", key:"god", value:true}` / `{op:"runFlag", key:"through", value:true}`                                   |
| Teleport                    | `chaya_edit_action {id:"teleport", mapId, x, y}`                                                                                       |
| Advance dialogue            | read it with `chaya_live_state` → `chaya_live_press {key:"ok"}`; for choices use `up` / `down` then `ok` (or `chaya_live_tap`)         |
| "What now?" / skipped story | `chaya_live_history` (summarize recent dialogue and choices) → `chaya_live_state`; `chaya_live_screenshot` only if the picture matters |
| Save before editing         | `chaya_edit_action {id:"save", slot:1}` first; if something breaks, `{id:"load", slot:1}`                                              |
| Whole-game fill             | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → poll `{action:"status"}`                                          |
| Fix one translation         | `chaya_cache_query {q:"source snippet"}` → `chaya_cache_update {src, zh}`                                                              |
| Debug plugin errors         | `chaya_logs_query {level:"fail"}` or `{source:"ChayaEdit"}`                                                                            |
| Start a game                | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → wait a few seconds → `chaya_live_games`                            |

## WebMCP (agents in the browser)

Every console page registers WebMCP tools through `document.modelContext`, a superset of the MCP tools:

- All MCP tools: App / local dev mirror `/api/mcp`; the Edge web version implements them in the browser (except launching games, uninstall commands, window, `eval`, batch translation and clearing logs).
- Extra: `page_*` page tools (navigate, snapshot, read text, click, fill, press, scroll, wait); Edge registers plugin tools automatically once a game connects. The game window itself registers no WebMCP tools.
- Enable: Chrome 146+ with `chrome://flags/#enable-webmcp-testing`; see the console's Integrations → WebMCP page.

## Rules

- **Ask the user before destructive tools**: `chaya_library_remove`, `chaya_game_plugins_clear`, `chaya_game_shell_uninstall`, `chaya_cache_delete`, `chaya_logs_clear`, `chaya_live_quit`, `chaya_live_eval`, and `chaya_edit_action` save / load / fix:title / battle:defeat / battle:partyHp0.
- Save with `chaya_edit_action {id:"save"}` before big edits; save overwrites a save slot and load discards current progress, so ask the user first for both.
- `gameId` can be omitted when only one game is online; with several online, call `chaya_live_games` first and pass it.
- `chaya_live_eval` only appears when the server sets `CHAYA_MCP_EVAL=1`; do not use it when an edit tool can do the job.
- When a tool fails, pass the original error to the user (e.g. "no connected game" usually means the game was not launched from Chaya or lacks ChayaAgent).
