---
name: chaya-mcp
description: Use the local Chaya MCP server to control the game library, launch games, make live edits (gold / items / actors / teleport / keys), translate, manage the translation library and read logs. Use when the user wants the agent to operate the game or Chaya plugins directly.
---

# Chaya MCP: let the agent control the game

## Prerequisites

- Chaya runs as the **App or local dev** (the Edge web version has no MCP).
- Live tools (`chaya_live_*`) need the game **launched from Chaya** with the `ChayaAgent` plugin loaded; for older games run `chaya_game_plugins_install` and restart first.

## Connect

- Endpoint: `http://127.0.0.1:3927/api/mcp`
- Auth: header `Authorization: Bearer <token>`. Copy the token from the console's Integrations → MCP page, or from `data/access/token` in local dev.
- Cursor `~/.cursor/mcp.json`:

  ```json
  {
    "mcpServers": {
      "chaya": {
        "url": "http://127.0.0.1:3927/api/mcp",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
  ```

- Claude Code: `claude mcp add --transport http --scope user chaya http://127.0.0.1:3927/api/mcp --header "Authorization: Bearer <token>"`

## Tool groups

| Group               | Tools                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Library             | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                                                                                        |
| Current game        | `chaya_game_status` / `launch` / `quit` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                                                                                             |
| Live game           | `chaya_live_games` / `state` / `plugins` / `call` / `press` (`eval` is off by default)                                                                                                                                                     |
| Edit catalog        | `chaya_edit_catalog`                                                                                                                                                                                                                       |
| Translation         | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                                                                                         |
| Translation library | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                                                                                                       |
| Logs                | `chaya_logs_query` / `clear`                                                                                                                                                                                                               |
| Plugin tools        | `chaya_plugin_edit_*` (gold / item / variable / switch / god / through / teleport / common_event / save / load / find), `chaya_plugin_boost_*` (on / off / status), `chaya_plugin_trans_*` (status / reload) — only while a game is online |

Full parameters are on the console's Integrations → MCP page or in `tools/list`. Plugin tools can also be called through `chaya_live_call {plugin, tool, input}`; `chaya_live_plugins` lists the tools each plugin declares.

## Standard workflow

1. **Read state**: `chaya_game_status` (binding, shell, plugins, online); use `chaya_live_state` while the game runs.
2. **Look up ids**: `chaya_edit_catalog` (e.g. `kind=items, q=ポーション`).
3. **Act**: `chaya_live_call` / `chaya_live_press` / translation or library tools.
4. **Confirm**: read the state or logs again and report the before / after to the user.

## Recipes

| Goal                    | Calls                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Set gold to 99999       | `chaya_plugin_edit_gold {value:99999}` (or `chaya_live_call {plugin:"ChayaEdit", method:"gold", args:[99999]}`)        |
| Give 10 of an item      | `chaya_edit_catalog {kind:"items", q:"potion"}` → `chaya_live_call {plugin:"ChayaEdit", method:"item", args:[id, 10]}` |
| Actor 1 HP to 999       | `chaya_live_call {plugin:"ChayaEdit", method:"actor", args:[1], chain:[{method:"hp", args:[999]}]}`                    |
| God mode / walk-through | `ChayaEdit.god(true)` / `ChayaEdit.through(true)`                                                                      |
| Teleport                | `ChayaEdit.teleport(mapId, x, y)`                                                                                      |
| Advance dialogue        | read it with `chaya_live_state` → `chaya_live_press {key:"ok"}`; for choices use `up` / `down` then `ok`               |
| Save before editing     | `ChayaEdit.save(1)` first; if something breaks, `ChayaEdit.load(1)`                                                    |
| Whole-game fill         | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → poll `{action:"status"}`                          |
| Fix one translation     | `chaya_cache_query {q:"source snippet"}` → `chaya_cache_update {src, zh}`                                              |
| Debug plugin errors     | `chaya_logs_query {level:"fail"}` or `{source:"ChayaEdit"}`                                                            |
| Start a game            | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → wait a few seconds → `chaya_live_games`            |

## WebMCP (agents in the browser)

Every console page registers WebMCP tools through `document.modelContext`, a superset of the MCP tools:

- All MCP tools: App / local dev mirror `/api/mcp`; the Edge web version implements them in the browser (except launching games, uninstall commands, window, `eval`, batch translation and clearing logs).
- Extra: `page_*` page tools (navigate, snapshot, read text, click, fill, press, scroll, wait) and `chaya_web_edit_*` live edit panel tools; Edge registers plugin tools automatically once a game connects.
- Enable: Chrome 146+ with `chrome://flags/#enable-webmcp-testing`; see the console's Integrations → WebMCP page.

## Rules

- **Ask the user before destructive tools**: `chaya_library_remove`, `chaya_game_plugins_clear`, `chaya_game_shell_uninstall`, `chaya_cache_delete`, `chaya_logs_clear`, `chaya_live_eval`.
- Save with `ChayaEdit.save(slot)` before big edits; `chaya_plugin_edit_save` overwrites a save slot and `chaya_plugin_edit_load` discards current progress, so ask the user first for both.
- `gameId` can be omitted when only one game is online; with several online, call `chaya_live_games` first and pass it.
- `chaya_live_eval` only appears when the server sets `CHAYA_MCP_EVAL=1`; do not use it when a plugin method can do the job.
- When a tool fails, pass the original error to the user (e.g. "no connected game" usually means the game was not launched from Chaya or lacks ChayaAgent).
