# 存储策略：公共 / 游戏内 / IndexedDB 技术方案

> 状态：**实现接线已更新，正在回归验证；本文中的验收矩阵是待验证要求，不表示已经全部通过**；2026-10-24。  
> 关联规范：[`data-layout.md`](./data-layout.md)；代码基准：`constants/paths.ts`、`lib/game/content-paths.ts`、`services/translate/`、`services/game-agent/`。  
> 核心约束：资产配置真源收束于公共目录；局内目录仅存可丢物、待重放离线日志与局内存档；浏览器仅保留视图状态；多端读写收敛至本机单实例数据服务。

---

## 1. 架构总览与分层所有权

本方案解决当前耐久层分散（`data/`、游戏旁 `chaya/`、浏览器 IDB/LS、OS 旁路配置）导致的数据丢失、版本迁移断裂与多进程抢库问题。

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 客户端层: 游戏插件 (NW/Electron/mkxp-z) │ 控制台前端 (Local/Cloud) │ CLI │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / IPC (带 Idempotency-Key + Token)
┌───────────────────────────────────▼────────────────────────────────────┐
│ 本机单实例数据服务 (Local Storage Daemon: 随 App / 壳按需拉起，生命周期独立)   │
│  - 独占保证: 规范化数据根 SQLite guard 独占事务 + instanceId 元数据 │
│  - 内存层: 有界 RPC 查询 + 可重建只读文件视图 + revision 校验          │
│  - 写入层: 事务写队列 + 幂等去重表 + 业务规则与冲突校验 (Tombstone)     │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │ 独占持有 SQLite 连接            │ 原子文件写入
┌───────────────────▼────────────────────────┐ ┌─────▼───────────────────┐
│ 公共耐久桶 (CHAYA_DATA_DIR: 升级与重装不丢) │ │ 游戏内桶 (contentRoot) │
│  - 翻译库: translate-cache/shared.sqlite   │ │  - 局内插件缓存 (可清理) │
│  - 旅伴库: companion-memory/companion.sqlite │ │  - 离线待重放日志 (待提交)│
│  - 统一配置: game-agent/settings.json      │ │  - 游戏原生存档 / 改包物 │
│  - 身份基线: game_identities (库内表)      │ └─────────────────────────┘
│  - 运行令牌: runtime/storage-daemon.json   │ ┌─────────────────────────┐
└────────────────────────────────────────────┘ │ 浏览器桶 (Origin IDB/LS)│
                                               │  - 仅保留 UI 布局与 Token│
                                               └─────────────────────────┘
```

### 1.1 三桶职责与生命周期划分

| 落点         | 根路径                                     | 包含数据                                                                                                                           | 生命周期与清理规则                                                                                                                      |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **公共桶**   | `CHAYA_DATA_DIR`（打包为 `userData/data`） | 译文库、旅伴记忆库、统一 Agent 配置、游戏库元数据、离线包、下载作业快照                                                            | **应用更新与覆盖安装必须保留**；用户显式选择“彻底清除用户数据”方可移除；禁止任何自动策略删除。                                          |
| **游戏内桶** | `<contentRoot>/chaya/`                     | 跟踪插件磁盘缓存（`plugins/`）、配置缓存、用户存入游戏内的存档（`saves/`）、离线待重放日志（`pending-mutations.ndjson`）、改包回写 | **随游戏目录移动或丢弃**；`plugins/` 可随时清空重建；局内存档属用户数据，禁止静默随缓存清除；离线日志仅作待提交缓冲，不作权威真源读取。 |
| **浏览器桶** | 页面 Origin 作用域                         | 语言偏好、侧栏收起状态、窗口连接 Token、活动游戏暂存、FSA 句柄                                                                     | **刷新即恢复，清站点可安全重建**；**严禁**存放译文、记忆、存档或 Agent 权威配置。                                                       |

---

## 2. 数据库物理划分与 Schema 规范

为避免高频翻译查询与流式旅伴记忆归约（含配额 Compaction）产生 WAL 读写锁争用，**翻译与旅伴物理分库**。两库均位于公共桶，由单实例数据服务统一管理。

### 2.1 翻译库：`shared.sqlite`

库路径：`$CHAYA_DATA_DIR/translate-cache/shared.sqlite`。采用 Drizzle ORM + 原生 `DatabaseSync`。  
连接初始化必须执行：`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;`。

```sql
-- 1. 本作独占译文表（区分游戏作用域，支持 Tombstone 屏蔽）
CREATE TABLE IF NOT EXISTS game_translations (
  game_id TEXT NOT NULL,
  src TEXT NOT NULL,
  src_lang TEXT NOT NULL DEFAULT 'ja',
  tgt_lang TEXT NOT NULL DEFAULT 'zh',
  zh TEXT,                                   -- 译文内容；Tombstone 时可保留历史文本或为 NULL
  engine TEXT NOT NULL DEFAULT 'manual',     -- manual | agent | seed | import | google | ...
  category TEXT,                             -- dialogue | item | skill | menu | ...
  is_deleted INTEGER NOT NULL DEFAULT 0,     -- 1: Tombstone 标记，坚决阻断共享库回退
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, src, src_lang, tgt_lang)
);
-- 点查走复合主键；快照导出与按语言扫描走覆盖索引
CREATE INDEX IF NOT EXISTS idx_game_trans_lookup ON game_translations(game_id, src_lang, tgt_lang, is_deleted);
CREATE INDEX IF NOT EXISTS idx_game_trans_updated ON game_translations(game_id, updated_at);

-- 2. 跨游戏共享候选池（去重沉淀通用译文，物理表名为 translations 以兼容既有库与 Drizzle Schema）
CREATE TABLE IF NOT EXISTS translations (
  src TEXT NOT NULL,
  src_lang TEXT NOT NULL DEFAULT 'ja',
  tgt_lang TEXT NOT NULL DEFAULT 'zh',
  zh TEXT NOT NULL,
  engine TEXT,
  category TEXT,
  nsfw INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (src, src_lang, tgt_lang)
);
CREATE INDEX IF NOT EXISTS idx_translations_lookup ON translations(src_lang, tgt_lang, nsfw);
CREATE INDEX IF NOT EXISTS idx_translations_category ON translations(category);

-- 3. 游戏身份基线表（解决指纹漂移与串库）
CREATE TABLE IF NOT EXISTS game_identities (
  game_id TEXT PRIMARY KEY NOT NULL,         -- UUID v4，游戏稳定业务 ID
  engine TEXT NOT NULL,                      -- MV | MZ | VX Ace | VX
  title TEXT NOT NULL,                       -- 初始绑定展示名
  signature_baseline TEXT NOT NULL,          -- 核心静态内容 SHA-256（见 §3）
  signature_version INTEGER NOT NULL DEFAULT 1,
  bound_path TEXT NOT NULL,                  -- 规范化绝对路径
  first_bound_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_identities_sig ON game_identities(signature_baseline);
CREATE INDEX IF NOT EXISTS idx_game_identities_path ON game_identities(bound_path);

-- 4. 写请求幂等审计表
CREATE TABLE IF NOT EXISTS mutation_log (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

#### 业务作用域与 Tombstone 屏蔽语义

1. **检索优先级链条与 Tombstone 判定**：
   - 唯一有效 Tombstone 判定标志为 `is_deleted = 1`（`zh` 字段可保留历史文本供审计与撤销恢复）。
   - 检索时优先以 `(game_id, src, src_lang, tgt_lang)` 查 `game_translations`：
     - 若命中且 `is_deleted = 0`，返回本作译文；
     - 若命中但 `is_deleted = 1`，**立即终止查询链条并判定为未翻译，严禁继续回退至共享池**；
     - 若本作未命中任何记录，则降级查询跨游戏共享表 `translations`；
     - 仍未命中则返回空。
2. **复活与修改语义**：当用户对已删除条目输入新翻译时，事务内执行更新：`is_deleted = 0`、更新 `zh`、`engine = 'manual'`、更新 `updated_at`，解除屏蔽。
3. **回流策略**：仅当本作译文为人工手改 (`engine = 'manual'`) 且明确不包含专有占位符时，才异步沉淀至 `translations` 共享表。

### 2.2 旅伴记忆库：`companion.sqlite`

库路径：`$CHAYA_DATA_DIR/companion-memory/companion.sqlite`。替代历史散落的 `companion-memory/<hash>/*.json`。  
**硬性约束**：每次打开 SQLite 连接**必须显式执行 `PRAGMA foreign_keys = ON;`**，否则 SQLite 默认忽略外键，`ON DELETE CASCADE` 将失效导致证据孤儿行累积。

```sql
-- 1. 游戏记忆状态元表
CREATE TABLE IF NOT EXISTS companion_manifest (
  game_id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  generation INTEGER NOT NULL DEFAULT 1,
  memory_epoch INTEGER NOT NULL DEFAULT 1,
  recording_revision INTEGER NOT NULL DEFAULT 1,
  recording_enabled INTEGER NOT NULL DEFAULT 1,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 2. 经历事件表
CREATE TABLE IF NOT EXISTS companion_episodes (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- combat | exploration | milestone | ...
  persistence TEXT NOT NULL,                 -- committed | pending
  completeness TEXT NOT NULL,
  stable_key TEXT,
  outcome TEXT,
  data_json TEXT NOT NULL,                   -- 紧凑压缩序列化
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_game ON companion_episodes(game_id, created_at);

-- 3. 证据链条表（按经历级联删除）
CREATE TABLE IF NOT EXISTS companion_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES companion_episodes(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  memory_epoch INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_game ON companion_evidence(game_id);
CREATE INDEX IF NOT EXISTS idx_evidence_episode ON companion_evidence(episode_id);

-- 4. 批次去重表（滑动窗口 256）
CREATE TABLE IF NOT EXISTS companion_applied_batches (
  batch_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, batch_id)
);
```

### 2.3 审计与幂等表维护规范 (`mutation_log`)

1. **幂等命中处理**：翻译提交、插件待重放队列和旅伴批次均保存内容指纹；同一个 key 重试返回已提交结果，同 key 不同内容报冲突。
2. **长期离线重放**：不对幂等凭证设置 14 天 TTL，否则旧客户端重放会再次执行历史操作。审计归档必须保留幂等摘要。
3. **作用域**：游戏写入凭证在 `game_mutation_receipts` 中按 `(game_id,key)` 隔离；旅伴凭证在 `companion_applied_batches` 中按 `(game_id,batch_id)` 隔离。

---

## 3. 游戏身份模型与内容签名引擎

现有 `fingerprint` 仅扫描外围壳和插件，无法区分同引擎作品（如多个 RGSS 游戏均只有默认引擎名），且换壳、装插件时指纹会漂移。本方案建立**三层身份分离机制**。

### 3.1 身份三层定义

1. **稳定 Game ID (`game_id`)**：UUID v4，写入游戏库时确立，为公共译文、旅伴记忆与设置的唯一业务主键。复制目录或移动路径**不改变 Game ID**。
2. **物理文件路径 (`gameRoot`)**：游戏当前位于磁盘的位置，可通过“重新定位”安全变更。
3. **内容身份签名 (`signature_baseline`)**：基于不可变游戏静态资产生成的加密级散列，用于校验“当前目录是否依然是对应的那款游戏”。

### 3.2 内容签名算法 (Algorithm v1)

签名计算**严格排除**：`chaya/` 目录及其所有产物、游戏存档（`*.rpgsave`, `*.rvdata2`）、可执行壳（`nw.exe`, `Game.app`）与临时日志。

#### MV / MZ 签名收集

文件路径需进行不区分大小写匹配（兼容 Linux/Steam Deck/macOS 大小写敏感文件系统）：

1. `data/System.json`（或 `Data/System.json`）：提取 `{ gameTitle, versionId, startMapId, startX, startY, editDigest }`（排除动态运行时字段）。
2. `data/Actors.json`（或 `Data/Actors.json`）：提取有效角色列表的前 8 个角色条目：`{ id, name, profile }`。
3. `package.json`（优先 `contentRoot`，不存在则查 `projectRoot`）：提取 `{ name, title }`。
4. 若 `System.json` 经官方工具加密打包（`System.rpgmvp` / `System.png` 伪装）：提取加密扩展名、主页 html 标题特征与角色资源前导头作为签名补偿。

#### RGSS (VX Ace / VX) 签名收集

1. `Game.ini`（大小写候选）：提取 `[Game]` 小节下的 `Title` 与 `Scripts`。
2. **明文数据收集**：若存在 `Data/System.rvdata(2)` 与 `Data/Actors.rvdata(2)`，分别读取前 16 KiB 与 8 KiB 二进制头。
3. **加密封包容灾收集（针对 DLsite/商业加密发售）**：若未发现明文 `Data/` 目录，必须自动探测 `Game.rgss3a`、`Game.rgss2a` 或 `Game.rgssad` 封包文件。提取封包文件大小（`size`）+ 头部 16 KiB + 尾部 16 KiB 散列。**严禁在无明文数据且无封包散列时使用全零空 Buffer 计算签名**，防止大量同引擎默认工程发生哈希碰撞串库。

将上述归一化载荷使用 UTF-8 编码并通过 SHA-256 聚合为 64 位十六进制散列值。

### 3.3 签名比对状态机与通用默认名防御

```text
启动 / 绑定检测 ───▶ 计算当前目录 Signature
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  [MATCH: 完全一致]  [DRIFT: 轻微漂移]  [MISMATCH: 严重冲突]
        │                │                │
   直接挂载公共数据    提示检测到版本更新   【安全强阻断】
                      用户确认后更新基线   禁止读取/覆盖该 game_id 资产
                                          提供“重绑”或“新建记录”入口
```

- **MATCH**：签名一致，通过校验。
- **DRIFT（版本演进）**：标题匹配且核心数据发生演进（如打升级补丁、官方 DLC 或汉化脚本写回）。
  - **通用默认标题防御规则**：若游戏标题属于通用缺省词表（如 `''`、`'game'`、`'rpg'`、`'untitled'`、`'rpg maker mz game'`、`'rpg maker mv game'`、`'rpg vx ace'`、`'未命名游戏'`），**坚决禁止仅凭标题一致判定为 DRIFT**；必须要求核心资产散列存在前向关联，否则判定为 `MISMATCH`，防止两个同样使用默认名的不同游戏互相冲撞。
  - **标题汉化重命名识别**：若静态资产签名一致或高度相符，但仅标题发生语言变更（如原名 `魔王の城` 变为 `魔王之城`），系统判定为 `DRIFT (RENAMED)`，提示用户“检测到游戏已汉化改名”，确认后同步更新基线标题与绑定。
- **MISMATCH（作品冲突）**：标题不符或散列全异。**强阻断公共资产读写**，避免将游戏 A 的记忆和翻译写入游戏 B。

### 3.4 游戏目录移动与重绑定机制

当玩家将游戏从路径 A 移动至路径 B 时：

1. 客户端首先在 `game_identities` 中以当前计算出的 `signature_baseline` 检索已有记录；
2. 若命中唯一匹配的 `signature_baseline`，说明游戏仅发生物理位置移动。数据服务自动更新该 `game_id` 对应的 `bound_path = 路径 B` 与 `last_verified_at`，保持所有译文与记忆无缝衔接。
3. 若未命中且路径已变，进入“新游戏登记”或“手动关联既有游戏”引导。

---

## 4. 本机单实例数据服务架构

解决多进程（控制台、壳、多开游戏）直接并发 `sqlite.open` 导致抢写、锁争用与升级分叉的问题。

### 4.1 进程模型与生命周期

- **单实例范围**：严格绑定至规范化解析后的绝对路径 `$CHAYA_DATA_DIR`（开发环境 `<repo>/data`，生产打包为 `userData/data`）。
- **按需拉起**：App、NW 壳、启动脚本均具备发现并拉起服务的能力。首个进程拉起服务；后启动进程握手复用。
- **客户端租约与空闲优雅退出**：
  - 服务提供心跳租约接口（租约超时 90 秒）；当前客户端每次 RPC 都续活动时间，不依赖常驻心跳。
  - 即使游戏壳或控制台异常崩溃（`kill -9` 未发送注销请求），租约在 90 秒后自动失效。
  - 仅当所有客户端租约过期且写队列清空后，触发 10 分钟空闲倒计时，倒计时结束服务优雅退出并释放锁。

### 4.2 互斥锁定与防脑裂接管机制

独占权由 `$CHAYA_DATA_DIR/runtime/storage-daemon.guard.sqlite` 上的 `BEGIN EXCLUSIVE` 事务持有。guard 文件永久保留，不 unlink、不替换 inode；进程崩溃后由 OS 释放 SQLite 文件锁。

`storage-daemon.lock` 和 `storage-daemon.json` 仅发布 PID、instanceId、端口与 Token；元数据本身不是互斥锁。新实例先取得 guard，再发布新 instanceId，最后在监听成功后更新端口。数据库与 RPC 队列关闭后才能释放 guard。

即使 PID 被复用，也不能仅依据 PID 删除锁。无法响应的实例允许客户端报错重试，独占权仍由 guard 决定，不强杀、不抢走活动数据库连接。

### 4.3 通信端点与认证

服务成功拉起后，在 `$CHAYA_DATA_DIR/runtime/storage-daemon.json` 发布握手凭证（文件权限 `0600`）：

```json
{
  "instanceId": "c8f94982-1209-4a92-b4c6-e9188092ca11",
  "pid": 48291,
  "startedAt": 1729760000000,
  "port": 3927,
  "authToken": "a4f8...6b2c",
  "protocolVersion": 1,
  "dataDir": "/Users/davidjones/Develop/ops/apps/chaya/data",
  "bindHost": "127.0.0.1"
}
```

- **网络绑定与安全**：服务**严格且仅允许监听 `127.0.0.1` 本机环回接口**，严禁绑定 `0.0.0.0`，杜绝局域网未授权攻击；默认端口为 3927，若端口被占用则自动退避选取系统随机可用端口（port 0）并将分配端口写回凭证文件。所有请求头必须包含 `X-Chaya-Auth-Token`。
- **有界快照读取策略（防内存耗尽）**：
  - 客户端通过 `GET /api/storage/translations/snapshot?gameId=...` 分页获取快照；实际产品兼容入口使用 `POST /api/storage/rpc`。
  - **内存安全边界**：本作条目（含 Tombstone）按游标分页返回；对于共享库 `translations`，**严禁全量 dump 数十万条全局译文进游戏进程**（防止 NW.js 32 位堆内存溢出），仅预取高频系统词（`category = 'common' | 'system'`）或客户端在握手时提供的本工程字串基线交集；其余共享条目在游玩过程中按需异步懒拉取并缓存至只读 LRU。
- **批量写入与幂等提交**：
  - 写入端点：`POST /api/storage/translations/commit`，请求体携带 `idempotencyKey` 与 `entries: Array<{ src, zh, srcLang, tgtLang, engine, category, isDeleted }>` 批量数组（避免逐句 HTTP 请求造成网络风暴）。
  - 服务在事务中提交并递增游戏 revision，再原子替换公共目录的只读文件视图；插件比较 inode、mtime 与大小后重载。当前采用文件轮询，不提供 SSE 广播。
- **离线降级与写入暂存（防丢数据）**：
  - 若数据服务断开，客户端除保留内存待提交队列外，**允许且应当**向局内临时目录追加写入离线日志：`<contentRoot>/chaya/translate/pending-mutations.ndjson`。
  - **权威性约束**：该日志仅为追加式未决队列（Dirty Write-Ahead Log），游戏插件与控制台**严禁将其作为已提交的权威真源直接消费**。
  - 当数据服务重新连接后，客户端自动重放该文件内的条目至服务端的 `/commit` 端点，确认成功后清空/截断该文件，避免游戏崩溃导致用户翻译成果丢失。

---

## 5. 升级、数据迁移与容灾流水线

废弃“默认导入重建”策略，确立**以版本化增量迁移为主、收束重构才走原子重建**的原则。

### 5.1 增量升级机制

- SQLite 原生维护 `PRAGMA user_version`。
- 字段追加、非空约束优化、新增索引一律由数据服务启动时在事务内执行 DDL，失败直接回滚，不得破坏既有库。

### 5.2 本波真源收束迁移清单

| 现有真源位置                               | 迁移目标                             | 迁移策略与约束                                                                |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `contentRoot/chaya/translate/seed.json`    | `shared.sqlite -> game_translations` | **按局懒迁移**：打开/关联该游戏时按 `game_id` 导入，标记 `engine = 'seed'`。  |
| `contentRoot/chaya/translate/cache.ndjson` | `shared.sqlite -> game_translations` | **按局懒迁移**：打开/关联该游戏时按行解析导入，保留最新时间与计数。           |
| `data/translate-cache/shared.sqlite`       | `shared.sqlite -> translations`      | **启动全量迁移**：原 `translations` 表无损升级，补齐 DDL 结构。               |
| `data/companion-memory/<hash>/`            | `companion.sqlite`                   | **启动全量迁移**：顺序重放有效 checkpoint 与 journal batches，维护 epoch 序。 |
| `data/game-agent/settings.json`            | `data/game-agent/settings.json`      | 规范化为单 Profile 结构，移除未生效配置。                                     |

### 5.3 严格废弃的遗留源（不迁移、不读、严禁反向覆盖）

以下位置包含历史碎片，升级后**直接废弃**，新逻辑不再读取或合并：

1. 浏览器 `IndexedDB`（`chaya-game-saves`、`chaya-agent-history`、`chaya-agent-activity`）。
2. 浏览器 `localStorage`（`chaya.gameAgent.*`）。
3. 操作系统旁路目录（`~/Library/Application Support/Chaya/game-agent.json`）。
4. 历史扁平文件（`*-trans.seed.json`, `shiru-trans.*`）。

### 5.4 原子切库与保守恢复

普通源数据收束使用目标库事务导入，并在同一事务写导入凭证。游戏 seed/cache 支持当前结构与旧扁平文件；源文件保留。旅伴使用原文件后端的 checkpoint / journal / epoch 回放规则，保存完整快照及规范化的经历、证据、幂等凭证。OS 的旧 Agent 文档只导入一次，源文件保留。

需要整库重建时，调用方必须持有 guard，并关闭应用数据库连接：

1. 对旧库和 `.migrating` 执行 checkpoint，检查返回的 busy 标志；关闭校验连接后仍有 WAL/SHM 则拒绝切换。
2. 校验 `integrity_check` 与 `foreign_key_check`，对旧库执行 `VACUUM INTO` 备份，fsync 暂存库和备份。
3. 先写包含新库 SHA-256 的 `.cutover.json`，再把旧库改名 `.archive`，把暂存库改名为正式库。多次 rename 不是一个原子事务，恢复依赖日志与摘要。
4. 校验正式库，持久化 complete 状态；备份、归档与日志全部保留，不自动删除。
5. 服务在 guard 内、打开正式数据库前恢复切换日志。无日志的暂存库或归档来源不明，拒绝自动删除或提升。

迁移失败时不写完成凭证，不吞掉坏 JSON / 坏 NDJSON。只读视图写入失败不会回滚已经提交的 SQLite 事务；后续 mount / 同 key 重试根据 `.revision` 重新生成视图。

### 5.5 过旧版本恢复策略

设定 `MIN_SUPPORTED_DATA_VERSION = 1`。

- **程序版本过旧**：安装最新程序，保留数据目录。
- **数据版本过旧（低于兼容下限）**：
  1. **明确阻断启动**，提示：“数据版本过旧 (v0.x)，当前程序无法直接迁移”。
  2. **严禁提示用户重装当前发行版**（重装不会升级数据，会导致死循环）。
  3. 给出指引链接，引导用户通过指定的中间过渡版本（如 v0.1.x）完成阶梯升级。
  4. 若用户主动选择丢弃，必须要求输入确认词，并将旧数据目录安全移至 `data/quarantine-<timestamp>/` 隔离区后，方可创建新数据。

---

## 6. 控制台、壳与 Cloud 交互模式

按“纯本机游玩、Cloud 仅作为遥控面板”模式定稿，不设纯浏览器游戏宿主：

1. **启动器 / NW 壳 / App**：
   - 启动本地游戏进程，通过文件系统或本机回环加载数据服务快照。
   - 产生的新译文与记忆写入本机数据服务。
2. **控制台 (Local)**：
   - 直接连接本地数据服务，读写公共库。
3. **控制台 (Cloud 网页)**：
   - 仅负责呈现与远程操作，数据必须通过 WebRTC / GameLink 经过本机通道与本地数据服务通信。
   - 若本机离线，Cloud 页面**禁用持久化修改**，绝不将游戏资产落盘到浏览器 IndexedDB。

---

## 7. 实施计划与里程碑

本波定位为**底层结构优化**（不包含用户可见的 zip 备份与导出向导功能），按以下批次实施：

```text
Phase 1: 存储基础设施 (T0)
  ├── 1.1 实现单实例数据服务进程骨架与 SQLite guard 独占事务协议
  ├── 1.2 实现 shared.sqlite 与 companion.sqlite 的 DDL 与 Drizzle Schema
  └── 1.3 实现游戏身份内容签名算法 (MV/MZ + RGSS) 与基线存储

Phase 2: 迁移流水线与服务化读写 (T1)
  ├── 2.1 实现带有快照备份与自愈检测的原子迁移流水线
  ├── 2.2 实现局内 translate/* 到 shared.sqlite 的迁移转换器
  ├── 2.3 实现 companion-memory JSON 重放至 companion.sqlite
  └── 2.4 提供本地 HTTP RPC 变更提交与公共只读视图刷新接口

Phase 3: 客户端接线与旧路径切除 (T2)
  ├── 3.1 改造 NW 插件 Translator 运行时：从本地读取切换为拉取服务快照
  ├── 3.2 改造 Companion Host：持久化后端直连本地服务接口
  ├── 3.3 切断 OS game-agent.json 与浏览器 IDB 的双写/回填通道
  └── 3.4 游戏目录标记已迁移状态，移除局内老写逻辑
```

---

## 8. 验证计划与测试矩阵

验收必须通过以下 14 项关键容灾测试：

1. **多进程并发拉起**：同时拉起控制台 App 与 3 个游戏壳，验证只有 1 个成为数据服务主控，其余 3 个全部正常握手连接，无锁死。
2. **窗口生命周期分离**：启动游戏后关闭控制台窗口，游戏内继续触发未翻译对话与记忆事件，验证数据正常落盘。
3. **异常中断孤儿锁接管**：对运行中的服务进程执行 `kill -9`，新客户端能在确认 PID 死亡后安全清除锁并重新拉起服务。
4. **假死抗争防护**：模拟服务进程长暂停（`SIGSTOP`），新进程探测到 PID 仍然存活，拒绝抢锁接管，防止脑裂。
5. **原子迁移中途断电**：在数据迁移执行到 50% 时强制退出进程，重启后验证未确认的暂存库被保留，正式库保持可恢复。
6. **WAL 文件三元组切换一致性**：在 WAL 存在未归档事务时触发迁移切换，验证 checkpoint(TRUNCATE) 正常执行，无孤儿 `-wal` 污染新库。
7. **PID 复用与跨机探活**：模拟系统重启后 PID 被其它程序占用，新拉起的进程通过 HTTP 握手探活识别假死，安全接管。
8. **通用默认名隔离防护**：两个不同游戏均使用 `Title = 'Game'` 或空标题，验证签名算法坚决阻断其判定为 DRIFT，强制 MISMATCH 隔离。
9. **游戏身份漂移与重定位**：
   - 游戏目录改名：验证稳定 Game ID 保持不变，通过绝对路径重定向继续生效。
   - 覆盖安装补丁：验证触发 DRIFT 提示，用户确认后平滑更新基线。
   - 换入完全不同的游戏目录：验证触发 MISMATCH 强阻断，拒绝污染旧资产。
10. **Tombstone 屏蔽与复活**：在游戏内删除译文验证屏蔽共享库回退；再次输入新译文验证 `is_deleted = 0` 成功复活。
11. **服务离线本地待重放日志恢复**：服务宕机期间进行游戏，客户端将写入写入 `<contentRoot>/chaya/translate/pending-mutations.ndjson`，服务恢复后完整重放并清空日志。
12. **共享库快照内存边界防护**：共享库注入 50 万条无关译文，客户端拉取快照验证仅拉取高频词与基线交集，内存占用控制在 15MB 以内。
13. **外键级联删除有效性**：验证 `PRAGMA foreign_keys = ON;` 生效，删除 `companion_episodes` 行时关联的 `companion_evidence` 被物理级联删除。
14. **加密 RGSS 封包签名稳定性**：验证对于无明文 `Data/` 目录的商业打包游戏（`Game.rgss3a`），能够稳定提取头尾采样/尺寸特征生成唯一样本，杜绝空哈希碰撞。

## 9. 当前代码落点与验证边界

- 独立服务入口：`services/storage/daemon-entry.server.ts`；构建产物：`native/bin/chaya-storage-{daemon,client}.mjs`。App / 本机服务通过 detached Node 按需启动；插件通过 OS 目录里的非秘密 locator 复用或重启服务。
- 游戏数据真源：`translate-cache/shared.sqlite` 的 `game_translations`、`game_documents` 与 `game_identities`。`translate-cache/games/<gameId>/` 仅是服务生成的只读视图。
- 插件游戏任务、翻译、旅伴记忆、Agent 设置、游玩历史与浏览器 transcript 通过本机服务落盘；浏览器 transcript 从公共文档恢复，旧 LS 只作为一次性导入源。
- 输入辅助全局配置与工具设置由服务串行写公共文件。用户存档本体和索引仍在游戏目录；其策略配置进入公共库。
- 签名漂移当前会阻断复用；自动接受补丁、跨游戏合并和全量旧浏览器 IDB 导入均不允许隐式发生。显式确认重绑定界面仍需单独验收。
- 自动化结果与手动验证结果须分别记录。测试通过不等于真实用户目录已经完成迁移；游戏数据在挂载时导入，不能以临时测试目录冒充当前数据位置。
