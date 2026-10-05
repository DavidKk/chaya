# Chaya MCP：让 Agent 控制游戏

## 前提

- 所有情况只用一个地址：`http://127.0.0.1:39271/mcp`（默认端口 39271；改过端口时以游戏内「集成 → MCP」页显示的地址为准）。App / 本地 dev 也可直连自身地址（控制台「集成 → MCP」显示，`http://127.0.0.1:3000/api/mcp`，App 为 `3927`）。
- **App / 本地 dev** 运行时由它提供（全部工具）；否则由从 Edge 网页版装好插件后打开的游戏提供（只有局内工具与插件工具，不含 `eval`）。都没开时连接失败，打开后即恢复。
- 局内工具（`chaya_live_*`）需要游戏 **从 Chaya 启动** 且加载了 `ChayaAgent` 插件；旧游戏先 `chaya_game_plugins_install` 再重启。

## 连接

- 鉴权：无需。网关只监听 `127.0.0.1`，不需要令牌，客户端连上即可使用当前可用的全部工具。
- Cursor `~/.cursor/mcp.json`：

  ```json
  {
    "mcpServers": {
      "chaya": { "url": "http://127.0.0.1:39271/mcp" }
    }
  }
  ```

- Claude Code：`claude mcp add --transport http --scope user chaya http://127.0.0.1:39271/mcp`
- Codex：`codex mcp add chaya --url http://127.0.0.1:39271/mcp`

## 工具分组

| 分组       | 工具                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 游戏库     | `chaya_library_list` / `bind` / `remark` / `remove`                                                                                                                |
| 当前游戏   | `chaya_game_status` / `launch` / `plugins_install` / `plugins_clear` / `shell_install` / `shell_check` / `shell_uninstall` / `window`                              |
| 局内实时   | 游戏操作：`chaya_live_games` / `state` / `history` / `screenshot` / `press` / `play` / `tap` / `move_to` / `quit`（`eval` 默认关闭）；插件工具：`plugins` / `call` |
| 修改       | `chaya_edit_catalog` / `state` / `set` / `action`（即游戏内修改页）                                                                                                |
| 翻译       | `chaya_translate_text` / `extract` / `job` / `batch` / `engines` / `play_settings`                                                                                 |
| 共享翻译库 | `chaya_cache_query` / `update` / `delete` / `import`                                                                                                               |
| 日志       | `chaya_logs_query` / `clear`                                                                                                                                       |
| 插件工具   | `chaya_plugin_boost_*`（on / off / status）、`chaya_plugin_trans_*`（status / reload）——游戏在线时才出现                                                           |

完整参数见控制台「集成 → MCP」或 `tools/list`。插件工具也可用 `chaya_live_call {plugin, tool, input}` 调用，`chaya_live_plugins` 会列出每个插件声明的工具。Agent 不直接改游戏数据：修改一律走修改页预设（`chaya_edit_*`）。

## 标准工作流

1. **看状态**：`chaya_game_status`（绑定、壳、插件、是否在线）；游戏运行中用 `chaya_live_state`。
2. **查 id**：`chaya_edit_catalog`（如 `kind=items, q=ポーション`）。
3. **执行**：`chaya_edit_set` / `chaya_edit_action` / `chaya_live_press` / `chaya_live_tap` / 翻译或翻译库工具。
4. **确认**：再次读取状态或日志，向用户报告前后变化。

## 场景配方

| 需求                         | 调用                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 金钱改成 99999               | `chaya_edit_set {op:"gold", value:99999}`                                                                      |
| 给 10 个某物品               | `chaya_edit_catalog {kind:"items", q:"药"}` → `chaya_edit_set {op:"count", kind:"item", id, value:10}`         |
| 1 号角色 HP 999              | `chaya_edit_set {op:"actor", id:1, patch:{hp:999}}`                                                            |
| 无敌 / 穿墙                  | `chaya_edit_set {op:"runFlag", key:"god", value:true}` / `{op:"runFlag", key:"through", value:true}`           |
| 传送                         | `chaya_edit_action {id:"teleport", mapId, x, y}`                                                               |
| 推进对话                     | `chaya_live_state` 读对话 → `chaya_live_press {key:"ok"}`；选项用 `up` / `down` 再 `ok`（或 `chaya_live_tap`） |
| 「下一步做什么」/ 跳过了剧情 | `chaya_live_history`（总结最近对话与选择）→ `chaya_live_state`；需要看画面时再 `chaya_live_screenshot`         |
| 存档再改                     | 先 `chaya_edit_action {id:"save", slot:1}`，出问题 `{id:"load", slot:1}`                                       |
| 整作补译                     | `chaya_translate_extract` → `chaya_translate_job {action:"start"}` → 定期 `{action:"status"}`                  |
| 修正一条译文                 | `chaya_cache_query {q:"原文片段"}` → `chaya_cache_update {src, zh}`                                            |
| 排查插件报错                 | `chaya_logs_query {level:"fail"}` 或 `{source:"ChayaEdit"}`                                                    |
| 开游戏                       | `chaya_library_list` → `chaya_library_bind` → `chaya_game_launch` → 等几秒 `chaya_live_games`                  |

## WebMCP（浏览器内 Agent）

控制台每个页面都通过 `document.modelContext` 注册 WebMCP 工具，是 MCP 的超集：

- 全部 MCP 工具：App / 本地 dev 镜像 `/api/mcp`；Edge 网页版在浏览器内实现（启动游戏、卸载命令、窗口、`eval`、批量翻译、清日志除外）。
- 额外：`page_*` 页面工具（导航、快照、读文本、点击、输入、按键、滚动、等待）；Edge 连上游戏后自动注册插件工具。游戏窗口本身不注册 WebMCP 工具。
- 启用：Chrome 146+ 打开 `chrome://flags/#enable-webmcp-testing`；详见控制台「集成 → WebMCP」。

## 约定

- **破坏性工具先问用户**：`chaya_library_remove`、`chaya_game_plugins_clear`、`chaya_game_shell_uninstall`、`chaya_cache_delete`、`chaya_logs_clear`、`chaya_live_quit`、`chaya_live_eval`，以及 `chaya_edit_action` 的 save / load / fix:title / battle:defeat / battle:partyHp0。
- 大幅修改前建议先 `chaya_edit_action {id:"save"}` 存档；save 会覆盖存档位、load 会丢弃当前进度，都先问用户。
- 只有一个游戏在线时可省略 `gameId`；多个在线时先 `chaya_live_games` 再指定。
- `chaya_live_eval` 需要服务端设置 `CHAYA_MCP_EVAL=1` 才出现，能用修改工具时不要用它。
- 工具报错时把错误原文告诉用户（例如「没有已连接的游戏」通常是游戏未从 Chaya 启动或未装 ChayaAgent）。
