# Agent 能力总表

- **日期**：2026-10-04
- **状态**：已定稿；MCP、WebMCP、插件 MCP、内置 Agent 的能力增减**先改本文**，再改代码与其他文档
- **关联**：[integration.md](./integration.md)（集成页）、[mcp-local.md](./mcp-local.md)、[mcp-plugin.md](./mcp-plugin.md)、[mcp-edge.md](./mcp-edge.md)、[webmcp.md](./webmcp.md)、[game-agent.md](./game-agent.md)

---

## 1. 原则

1. **一份目录**：MCP 与 WebMCP 用同一份工具目录、同名同参同返回。
2. **WebMCP 只多页面工具**：同一环境下，WebMCP 等于该环境的 MCP，另加页面工具。
3. **能力分两类**：
   - **工具操作**：调用 Chaya 预设好的能力——游戏库、准备游戏、修改、插件功能、翻译、翻译库、日志、页面。
   - **游戏操作**：像玩家一样玩游戏——看状态、看最近剧情、看画面、按键、点击、人物行动、退出。只观察和输入，不改游戏数据。
4. **不直接改游戏数据**：Agent 改数值只能调用「修改」页同一套预设能力（同样的校验、锁定、确认回执，界面同步可见），不能任意改内部对象或调用插件的任意方法。
5. **外部 Agent 与内置 Agent 用同一份工具**：不设"内置独有"的工具。内置 Agent 在这份工具里再按 [game-agent.md](./game-agent.md) §9 的权限策略筛选（默认只读、写操作需玩家确认、不给 `chaya_live_eval`）。
6. **唯一例外**：`chaya_live_eval`（执行任意脚本）只在 server，且需要显式打开开关（`CHAYA_MCP_EVAL=1`），作为排障用的逃生口。

## 2. 环境

| 环境   | 入口                                                                     | 到游戏的通道       |
| ------ | ------------------------------------------------------------------------ | ------------------ |
| server | 本机 dev / App 的 MCP（`/api/mcp`），以及网页上的 WebMCP（另加页面工具） | ChayaAgent 长轮询  |
| Edge   | 网页版页面上的 WebMCP（没有服务端 MCP）                                  | 游戏 DataChannel   |
| 游戏内 | 插件 MCP（Edge 打开的游戏，给外部 Agent，本机网关）                      | 游戏进程内直接调用 |

内置 Agent 跑在本机服务上（调用本机 Ollama），游戏侧栏只是界面，调用游戏走 server 的长轮询；Edge 不提供内置 Agent。

## 3. 工具操作

✓ 可用 · ◐ 有条件 · ✗ 不提供。「需游戏在线」的工具在游戏进程内执行，三档都经各自通道调用。

### 3.1 游戏外（各环境不同）

| 分组     | 工具                                                                     | server | Edge                          | 游戏内 |
| -------- | ------------------------------------------------------------------------ | ------ | ----------------------------- | ------ |
| 游戏库   | `chaya_library_list` / `bind` / `remark` / `remove`                      | ✓      | ◐ `bind` 只切换库里已有的游戏 | ✗      |
| 当前游戏 | `chaya_game_status`、`chaya_game_shell_check`                            | ✓      | ◐ 需先授权读目录              | ✗      |
|          | `chaya_game_plugins_install` / `plugins_clear`、`shell_install`          | ✓      | ◐ 需先授权写目录              | ✗      |
|          | `chaya_game_launch`、`chaya_game_shell_uninstall`、`chaya_game_window`   | ✓      | ✗                             | ✗      |
| 翻译     | `chaya_translate_text` / `extract` / `job` / `engines` / `play_settings` | ✓      | ✓（游戏内运行时执行）         | ✓      |
|          | `chaya_translate_batch`                                                  | ✓      | ✗ 用 `job` 代替               | ✗      |
| 翻译库   | `chaya_cache_query` / `update` / `delete` / `import`                     | ✓      | ✓                             | ✓      |
| 日志     | `chaya_logs_query`                                                       | ✓      | ◐ 只读，与其他访问者共用      | ✓      |
|          | `chaya_logs_clear`                                                       | ✓      | ✗ 会清掉其他访问者的日志      | ✓      |
| 页面     | `page_*` 共 10 个（只在 WebMCP）                                         | ✓      | ✓                             | ✗      |

不可用的工具在 `page_get_context.unavailableTools` 中给出原因（Edge），插件 MCP 的说明（`MCP_PLUGIN_INSTRUCTIONS`）按分组概括（游戏内）。分组「当前游戏」的 `chaya_game_*` 是准备游戏目录，不是 §4 的游戏操作。

### 3.2 修改与插件功能（需游戏在线，各环境一致）

「修改」分组对应游戏内「修改」页的全部能力，Agent 与界面走同一套指令。`chaya_live_plugins` / `chaya_live_call` 名称沿用 `live` 分组，但归类为工具操作（`kind: 'tool'`）。

| 工具                 | 能力                                                                                                                    | 现状                                             | 目标                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------- |
| `chaya_edit_catalog` | 物品、变量、开关、角色等的名称与编号（供下面的工具查编号）；server 上带 `gameId` 时读该游戏，不带时读当前游戏的数据文件 | 各端已有；server 只读当前游戏的数据文件          | server 支持 `gameId` |
| `chaya_edit_state`   | 读修改会话：金钱、物品数、变量、开关、锁定、角色、移动倍率、运行开关                                                    | 只在网页（`chaya_web_edit_state`）               | 各端                 |
| `chaya_edit_set`     | 改值 / 锁定：金钱、物品数、变量、开关、角色属性、倍率、运行开关（含无敌、穿墙）                                         | 只在网页（`chaya_web_edit_set`）                 | 各端                 |
| `chaya_edit_action`  | 运行动作：打开场景、修复卡死、战斗控制（`scene:*` / `fix:*` / `battle:*`）；另并入传送、公共事件、存档、读档            | 运行动作只在网页；后几项是 `chaya_plugin_edit_*` | 各端，一个入口       |
| `chaya_plugin_*`     | 其他第一方插件的预设功能：ChayaBoost（加速开 / 关 / 状态）、ChayaTrans（状态 / 重新加载）                               | 各端已有                                         | 不变                 |
| `chaya_live_plugins` | 列出在线插件与它们声明的预设工具                                                                                        | 各端已有，另返回插件的全部方法名                 | 只返回声明的工具     |
| `chaya_live_call`    | 按工具名调用插件声明的预设工具（给没刷新工具清单的客户端）                                                              | 另支持任意方法的链式调用                         | 去掉任意方法调用     |

ChayaEdit 不再声明插件工具：`gold` / `item` / `variable` / `switch` / `god` / `through` 与 `chaya_edit_set` 重复，`find` 与 `chaya_edit_catalog` 重复，删除；`teleport` / `common_event` / `save` / `load` 并入 `chaya_edit_action`。

`chaya_edit_action` 参数：`{ id }`，`id` 为运行动作（与「修改」页相同），或 `teleport`（`mapId`、`x`、`y`、可选 `direction`）、`common_event`（`eventId`）、`save` / `load`（可选 `slot`，默认 1）。`save` / `load` 为破坏性，描述写明先征得用户同意。

## 4. 游戏操作（连上游戏后各环境一致）

统一放在 `live` 分组，名称 `chaya_live_*`。

| 能力     | 工具                                                                                                                   | 现状                                         | 目标           |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------- |
| 发现游戏 | `chaya_live_games`、`chaya_live_state`                                                                                 | 各端已有                                     | 不变           |
| 按键     | `chaya_live_press`、`chaya_live_play`（按键序列，返回操作后的状态）                                                    | 各端已有                                     | 不变           |
| 最近剧情 | `chaya_live_history`：最近渲染的对话、选项与所选项、地图切换、战斗开始与结果、读档（按时间顺序，默认 50 条、上限 300） | 无                                           | 各端           |
| 看画面   | `chaya_live_screenshot`：当前画面截图，按 MCP 图片内容（`type: 'image'`）返回（默认宽 512、上限 1280）                 | 只在游戏内 WebMCP（`chaya_game_screenshot`） | 各端           |
| 点击     | `chaya_live_tap`：在画面坐标点击（菜单、对话、按钮）                                                                   | 同上（`chaya_game_tap`）                     | 各端           |
| 人物行动 | `chaya_live_move_to`：地图上寻路走到格子坐标，等到达或超时（默认 8 秒、上限 12 秒）；途中被传送到别的地图即停          | 同上（`chaya_game_move_to`）                 | 各端           |
| 退出游戏 | `chaya_live_quit`                                                                                                      | server、Edge（`chaya_game_quit`）            | 各端           |
| 执行脚本 | `chaya_live_eval`                                                                                                      | server（需开关）                             | 不变，唯一例外 |

- `chaya_game_quit` 直接改名 `chaya_live_quit`（不留别名，skill 与文档同步）。
- `chaya_live_history` 用于"跳过了对话，问 Agent 如何过关 / 下一步做什么 / 总结最近进程"：先读剧情记录，再结合 `chaya_live_state`（必要时截图）回答；记录只在本机游戏进程内，不上传。记录的是游戏里的对话文本（「预翻译」模式下为译文，其他模式为原文并附已缓存的译文）。
- 截图较占 token：工具描述与 skill 写明"只在需要看画面时调用"。

## 5. 标注

- 只读：`chaya_edit_catalog`、`chaya_edit_state`、`chaya_live_state`、`chaya_live_history`、`chaya_live_screenshot`、`chaya_live_plugins`。
- 有后果：`chaya_edit_set`、`chaya_edit_action`、按键、点击、寻路、`chaya_live_quit`；存档、读档、退出为破坏性，描述写明先征得用户同意。
- 状态、剧情记录、截图、插件返回都标 `untrustedContentHint`（文本与画面来自游戏）。

## 6. 各入口的页面展示

- **server 集成页**：MCP 页列出 server 的工具（§3 + §4）；WebMCP 页列出本页登记的工具（同上 + 页面工具）。
- **Edge 集成页**：MCP 页保持空态，引导到游戏内（见 [mcp-edge.md](./mcp-edge.md)）；WebMCP 页列出 Edge 的工具（§3 Edge 列 + §4 + 页面工具）。
- **游戏内「集成」页**：只有 MCP（不再单列游戏内 WebMCP）。

## 7. 实现约束

- 工具目录每项标 `kind: 'tool' | 'game'`；游戏外工具按 §3.1 的环境矩阵（`lib/integration/mcp-availability.ts`）过滤，§3.2 与 §4 只要求连着游戏。页面、网关、文档都只读这份矩阵。
- 需游戏在线的能力都在游戏进程内实现一份，长轮询、DataChannel、本机网关三条通道按同一份白名单放行；DataChannel 仍拒绝 `game.eval`。
  - 指令、参数与返回见 [technical/webmcp.md](./technical/webmcp.md) §4.4。
  - 游戏操作由 ChayaAgent 实现（新增 `game.snap`、`input.tap`、`player.moveTo`、`game.quit`、`game.history`）。
  - 修改由 ChayaEdit 暴露读会话 / 应用指令的接口（复用「修改」页的 `applyEditCmd` 与会话读取），ChayaAgent 转发（新增 `edit.catalog`、`edit.state`、`edit.apply`、`edit.action`）；参数校验移到 `lib/runtime/edit-ops.ts`（工具层与游戏内共用）。
  - 收掉 `plugin.call`（任意方法链式调用），只保留 `plugin.tool`（声明的预设工具）。
- 通道限制：长轮询单次调用超时 15 秒（`AGENT_CALL_TIMEOUT_MS`），所以等待类工具（`move_to`）上限 12 秒；DataChannel 已按 4 KB 分片（上限 32 MB），截图大小不受限。
- 图片：MCP 协议层（`lib/integration/mcp-protocol.ts`）现在只输出 `text`，需要支持 `image` 内容；WebMCP 镜像（`parseMcpCallResult`）现在只取 `text`，需要透传图片。
- 安全：Edge 的 DataChannel 信令无鉴权。改值只经预设指令，收掉 `plugin.call` 后攻击面比现在小；截图是新增的读取面，按只读 + 不可信内容标注。
- 内置 Agent（[game-agent.md](./game-agent.md)）调用游戏时使用同一组指令，不另起一套。

## 8. 修订

| 日期       | 说明                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-04 | 初稿：能力分工具操作 / 游戏操作；游戏操作各端一致（截图 / 点击 / 寻路、实时修改并入），eval 为唯一例外                                                                          |
| 2026-10-04 | 评审修订：内置 Agent 跑在本机服务并按权限策略筛选；Edge 集成页 MCP 为空态；`quit` 改名 `chaya_live_quit`；`move_to` 上限 12 秒；补图片内容、标注与安全约束                      |
| 2026-10-04 | 修改归入工具操作：Agent 只调「修改」页预设能力（`chaya_edit_state` / `set` / `action`），合并重复的 ChayaEdit 插件工具，收掉 `plugin.call` 任意方法调用；游戏操作只含观察与输入 |
| 2026-10-04 | 细化：`find` 与 `chaya_edit_catalog` 重复，删除；`chaya_edit_action` 参数定稿；`chaya_live_quit` 不留别名                                                                       |
| 2026-10-04 | 新增 `chaya_live_history`：记录最近渲染的对话、选项、地图、战斗与读档，供跳过对话后问下一步 / 总结进程                                                                          |
| 2026-10-05 | 行走 demo 实跑：`move_to` 途中踩到传送点换图即停，返回 `transferred`                                                                                                            |
| 2026-10-05 | 行走 demo 实跑：server 的 `chaya_edit_catalog` 只读当前游戏的数据文件，与按 `gameId` 修改的游戏可能不是同一个；改为带 `gameId` 时经 `edit.catalog` 从游戏内读取                 |
| 2026-10-05 | 行走 demo 实跑：server 的 `chaya_live_quit` 只走 `DELETE /api/launch`，关不掉没装翻译运行时的游戏、也不分 `gameId`；改为发 `game.quit`，无长轮询游戏时才退回                    |
