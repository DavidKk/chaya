# 本机数据布局（备份 / 清理对照）

> 状态：现行。路径常量真源：`constants/path-names.ts`、`constants/paths.ts`、`lib/game/content-paths.ts`。  
> **三桶策略**（公共 / 游戏内 / IndexedDB）：[`storage-policy.md`](./storage-policy.md)。

## 1. 根目录

| 根          | 默认                                                                        | 覆盖                               |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------- |
| 工具箱数据  | `<repo>/data/`；打包为 Electron `userData/data`                             | `CHAYA_DATA_DIR`                   |
| 工具箱配置  | 开发：仓库根 `chaya.config.json`；打包：`$CHAYA_DATA_DIR/chaya.config.json` | —                                  |
| 日志        | `<repo>/logs/`                                                              | `CHAYA_LOGS_DIR` / `CHAYA_LOG_DIR` |
| 局内数据    | `<contentRoot>/chaya/`                                                      | —                                  |
| OS 用户配置 | macOS `~/Library/Application Support/Chaya/` 等                             | —                                  |

备份「整份 Chaya 本机数据」时以 **`CHAYA_DATA_DIR`（或 `data/`）** 为主；局内译文与设置在各自游戏的 `chaya/` 下，需另拷游戏目录。

## 2. `data/` 子目录（禁止再往根上堆运行时 JSON）

| 路径                                                               | 内容                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `shell/`、`shell-cache/`                                           | NW 壳与下载缓存                                                                |
| `rgss-runtime/`                                                    | mkxp-z 安装、下载、每局 launch 目录                                            |
| `translate-cache/shared.sqlite`                                    | 跨游戏共享译文                                                                 |
| `translate/agents.json`                                            | 共享 Agent 翻译引擎                                                            |
| `translate-jobs/`                                                  | Seed / sources 任务快照                                                        |
| `translation-packs/`                                               | Bergamot 离线包（可用 `CHAYA_BERGAMOT_PACKS_DIR` 覆盖；旧 XDG 路径会尝试迁入） |
| `download-jobs.json`                                               | 下载中心 NW/RGSS 任务快照（重启后运行中 → interrupted）                        |
| `companion-memory/<hash>/`                                         | 旅伴记忆                                                                       |
| `game-saves/games/<id>/`                                           | 工具箱侧存档镜像                                                               |
| `game-agent/settings.json`、`settings.sync.json`                   | Agent Profile（旧 `data/game-agent-settings*.json` 会迁入）                    |
| `game-agent/{secrets,credentials,cli-home,models,tool-settings,…}` | 密钥、CLI、模型缓存等                                                          |
| `runtime/launch-tokens.json`                                       | 启动令牌                                                                       |

## 3. 局内 `chaya/`

见 `GAME_CONTENT_RELS`：`translate/*`（含 `rgss-sources.index.json` Data signature 索引）、`config/{translation-play,translation-preview,game-edit,input-assistance,game-saves}.json`、`plugins/`、`saves/`。

## 4. Agent 配置多副本（有意分层，不是三份独立真相）

| 层       | 位置                                                   | 角色                                       |
| -------- | ------------------------------------------------------ | ------------------------------------------ |
| 本机服务 | `data/game-agent/settings.json` + `settings.sync.json` | local/app 权威；CRDT 式 sync 文档          |
| OS 共享  | `…/Chaya/game-agent.json`                              | NW 插件与多游戏进程间共享离线文档          |
| 浏览器   | `localStorage` `chaya.gameAgent.*` / 插件 sync 键      | cloud/remote；经 GameLink / API 与服务合并 |

合并规则见 [`game-agent.md`](./game-agent.md) §2.1。不要手改其中一层后期望另外两层自动一致——应走设置页或 sync API。

## 5. 刻意不持久化

- 游戏指纹（每次从文件计算）
- 浏览器通道内的下载任务（页面内存；服务端通道见 `download-jobs.json`）
- WebRTC / presence / 多数 session 单例

## 6. 会话 / 游玩轨迹（与 H3 目标路径的关系）

| 数据                   | 当前实现                                                                              | 需求文档中的目标（H3）                               |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 侧栏对话 / 任务 UI     | 浏览器 `localStorage` 任务键、companion transcript；本机活动见 `logs/agent-activity/` | `data/game-agent/conversations/`（尚未作为写入落点） |
| 游戏侧任务检查点       | 内存 + 活动事件；cloud 用 IndexedDB `chaya-agent-activity`                            | `chaya/agent/` 或 IDB（尚未普遍写入）                |
| 游玩 `game.history` 环 | IndexedDB `chaya-agent-history`（失败则回退 LS，并迁出旧 LS）                         | —                                                    |

旅伴 / 翻译落哪一桶、IndexedDB 只做壳：见 [`storage-policy.md`](./storage-policy.md)。
