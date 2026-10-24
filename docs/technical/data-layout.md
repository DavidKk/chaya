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

备份「整份 Chaya 本机数据」时以 **`CHAYA_DATA_DIR`（或 `data/`）** 为主；译文与设置在公共库中；原生存档、待提交离线日志与尚未导入的旧源文件仍需另拷游戏目录。

## 2. `data/` 子目录（禁止再往根上堆运行时 JSON）

| 路径                                                               | 内容                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `shell/`、`shell-cache/`                                           | NW 壳与下载缓存                                                                |
| `rgss-runtime/`                                                    | mkxp-z 安装、下载、每局 launch 目录                                            |
| `translate-cache/shared.sqlite`                                    | 跨游戏共享译文与按 gameId 隔离的本作译文、配置文档、身份基线                   |
| `translate/agents.json`                                            | 共享 Agent 翻译引擎                                                            |
| `translate-jobs/`                                                  | Seed / sources 任务快照                                                        |
| `translation-packs/`                                               | Bergamot 离线包（可用 `CHAYA_BERGAMOT_PACKS_DIR` 覆盖；旧 XDG 路径会尝试迁入） |
| `download-jobs.json`                                               | 下载中心 NW/RGSS 任务快照（重启后运行中 → interrupted）                        |
| `companion-memory/companion.sqlite`                                | 旅伴记忆；旧 `<hash>/` 仅保留为导入源                                          |
| `game-saves/games/<id>/`                                           | 工具箱侧存档镜像                                                               |
| `game-agent/settings.json`、`settings.sync.json`                   | Agent Profile（旧 `data/game-agent-settings*.json` 会迁入）                    |
| `game-agent/{secrets,credentials,cli-home,models,tool-settings,…}` | 密钥、CLI、模型缓存等                                                          |
| `runtime/launch-tokens.json`                                       | 启动令牌                                                                       |

## 3. 局内 `chaya/`

见 `GAME_CONTENT_RELS`：`translate/*`（含 `rgss-sources.index.json` Data signature 索引）、`config/{translation-play,translation-preview,game-edit,input-assistance,game-saves}.json`、`plugins/`、`saves/`。

## 4. Agent 配置统一来源

公共 `data/game-agent/settings.sync.json` 是同步真源，`settings.json` 是兼容视图，由本机存储服务维护。OS `…/Chaya/game-agent.json` 是保留的旧导入源，导入成功后写公共凭证；浏览器和插件只保留进程内配置快照，保存必须得到本机服务确认。

`…/Chaya/storage-runtime.json` 仅定位本机 runtime 与数据根；含认证令牌的元数据位于公共 `runtime/storage-daemon.json`，不能发送给 Cloud 页面。

公共 `translate-cache/games/<gameId>/` 保存可重建只读视图；`runtime/game-directories.json` 为插件定位视图。旧游戏目录的 seed/config 不再作为日常写入目标。

## 5. 刻意不持久化

- 游戏指纹（每次从文件计算）
- 浏览器通道内的下载任务（页面内存；服务端通道见 `download-jobs.json`）
- WebRTC / presence / 多数 session 单例

## 6. 会话与游玩轨迹

| 数据                  | 当前落点                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| 浏览器旅伴 transcript | 公共库 `game_documents`，kind 为 `companionTranscript`；页面仅内存视图   |
| 游戏游玩 history      | 公共库 `game_documents`，kind 为 `agentHistory`                          |
| 任务活动记录          | `logs/agent-activity/`，由本机服务归档；日志根仍由 `CHAYA_LOGS_DIR` 控制 |
| 旅伴记忆              | 公共 `companion-memory/companion.sqlite`                                 |
| 离线待提交翻译 / 记忆 | 游戏 `chaya/translate/pending-mutations.ndjson`；收到提交确认后移除      |

已有浏览器 IDB 数据不会静默删除；不再作为新写入的真源。游戏数据按挂载触发导入，尚未打开的游戏仍保留旧源文件，不能据此宣称其已经迁移。
