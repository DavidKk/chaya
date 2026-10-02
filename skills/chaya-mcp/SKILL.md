---
name: chaya-mcp
description: 通过 Chaya 本机 MCP 控制游戏库、启动游戏、局内修改（金钱 / 物品 / 角色 / 传送 / 按键）、翻译、翻译库与日志。用户要求 Agent 直接操作游戏或 Chaya 插件时使用。
---

# Chaya MCP：让 Agent 控制游戏

## 前提

- Chaya 以 **App 或本地 dev** 运行（Edge 网页版没有 MCP）。
- 局内工具（`chaya_live_*`）需要游戏 **从 Chaya 启动** 且加载了 `ChayaAgent` 插件；旧游戏先 `chaya_game_plugins_install` 再重启。

## 连接

- 地址：`http://127.0.0.1:3927/api/mcp`
- 鉴权：请求头 `Authorization: Bearer <token>`。token 在控制台「集成 → MCP」页面复制，或在本地 dev 的 `data/access/token`。
- Cursor `~/.cursor/mcp.json`：

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

- Claude Code：`claude mcp add --transport http --scope user chaya http://127.0.0.1:3927/api/mcp --header "Authorization: Bearer <token>"`

## 工具分组

| 分组       | 工具                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 游戏库     | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                            |
| 当前游戏   | `chaya_game_status` / `launch` / `quit` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window` |
| 局内实时   | `chaya_live_games` / `state` / `plugins` / `call` / `press`（`eval` 默认关闭）                                                                 |
| 修改目录   | `chaya_edit_catalog`                                                                                                                           |
| 翻译       | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                             |
| 共享翻译库 | `chaya_cache_query` / `update` / `delete` / `import`                                                                                           |
| 日志       | `chaya_logs_query` / `clear`                                                                                                                   |

| 插件工具 | `chaya_plugin_edit_*`（gold / item / variable / switch / god / through / teleport / common_event / save / load / find）、`chaya_plugin_boost_*`（on / off / status）、`chaya_plugin_trans_*`（status / reload）——游戏在线时才出现 |

完整参数见控制台「集成 → MCP」或 `tools/list`。插件工具也可用 `chaya_live_call {plugin, tool, input}` 调用，`chaya_live_plugins` 会列出每个插件声明的工具。

## 标准工作流

1. **看状态**：`chaya_game_status`（绑定、壳、插件、是否在线）；游戏运行中用 `chaya_live_state`。
2. **查 id**：`chaya_edit_catalog`（如 `kind=items, q=ポーション`）。
3. **执行**：`chaya_live_call` / `chaya_live_press` / 翻译或翻译库工具。
4. **确认**：再次读取状态或日志，向用户报告前后变化。

## 场景配方

| 需求            | 调用                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| 金钱改成 99999  | `chaya_plugin_edit_gold {value:99999}`（或 `chaya_live_call {plugin:"ChayaEdit", method:"gold", args:[99999]}`）   |
| 给 10 个某物品  | `chaya_edit_catalog {kind:"items", q:"药"}` → `chaya_live_call {plugin:"ChayaEdit", method:"item", args:[id, 10]}` |
| 1 号角色 HP 999 | `chaya_live_call {plugin:"ChayaEdit", method:"actor", args:[1], chain:[{method:"hp", args:[999]}]}`                |
| 无敌 / 穿墙     | `ChayaEdit.god(true)` / `ChayaEdit.through(true)`                                                                  |
| 传送            | `ChayaEdit.teleport(mapId, x, y)`                                                                                  |
| 推进对话        | `chaya_live_state` 读对话 → `chaya_live_press {key:"ok"}`；选项用 `up` / `down` 再 `ok`                            |
| 存档再改        | `ChayaEdit.save(1)` 后再修改，出问题 `ChayaEdit.load(1)`                                                           |
| 整作补译        | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → 定期 `{action:"status"}`                      |
| 修正一条译文    | `chaya_cache_query {q:"原文片段"}` → `chaya_cache_update {src, zh}`                                                |
| 排查插件报错    | `chaya_logs_query {level:"fail"}` 或 `{source:"ChayaEdit"}`                                                        |
| 开游戏          | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → 等几秒 `chaya_live_games`                      |

## WebMCP（浏览器内 Agent）

控制台每个页面都通过 `document.modelContext` 注册 WebMCP 工具，是 MCP 的超集：

- 全部 MCP 工具：App / 本地 dev 镜像 `/api/mcp`；Edge 网页版在浏览器内实现（启动游戏、卸载命令、窗口、`eval`、批量翻译、清日志除外）。
- 额外：`page_*` 页面工具（导航、快照、读文本、点击、输入、按键、滚动、等待）与 `chaya_web_edit_*` 局内修改面板工具；Edge 连上游戏后自动注册插件工具。
- 启用：Chrome 146+ 打开 `chrome://flags/#enable-webmcp-testing`；详见控制台「集成 → WebMCP」。

## 约定

- **破坏性工具先问用户**：`chaya_library_remove`、`chaya_game_plugins_clear`、`chaya_game_shell_uninstall`、`chaya_cache_delete`、`chaya_logs_clear`、`chaya_live_eval`。
- 大幅修改前建议先 `ChayaEdit.save(slot)` 存档；`chaya_plugin_edit_save` 会覆盖存档位、`chaya_plugin_edit_load` 会丢弃当前进度，都先问用户。
- 只有一个游戏在线时可省略 `gameId`；多个在线时先 `chaya_live_games` 再指定。
- `chaya_live_eval` 需要服务端设置 `CHAYA_MCP_EVAL=1` 才出现，能用插件方法时不要用它。
- 工具报错时把错误原文告诉用户（例如「没有已连接的游戏」通常是游戏未从 Chaya 启动或未装 ChayaAgent）。
