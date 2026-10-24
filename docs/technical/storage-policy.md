# 存储策略：公共 / 游戏内 / IndexedDB 技术方案

> 状态：**技术设计已定稿（已吸收 Review 架构优化与防御性设计，作为落地实现依据）**；2026-10-24。  
> 关联规范：[`data-layout.md`](./data-layout.md)；代码基准：`constants/paths.ts`、`lib/game/content-paths.ts`、`services/translate/`、`services/game-agent/`。  
> 核心约束：资产配置真源收束于公共目录；局内目录仅存可丢物与局内存档；浏览器仅保留视图状态；多端读写收敛至本机单实例数据服务。

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
│  - 独占保证: 规范化数据根文件锁 (flock / O_EXCL) + PID 真实活性校验       │
│  - 内存层: 只读快照 (Read Snapshot) + SSE 实时变更广播                 │
│  - 写入层: 事务写队列 + 幂等去重表 + 业务规则与冲突校验 (Tombstone)     │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │ 独占持有 SQLite 连接            │ 原子文件写入
┌───────────────────▼────────────────────────┐ ┌─────▼───────────────────┐
│ 公共耐久桶 (CHAYA_DATA_DIR: 升级与重装不丢) │ │ 游戏内桶 (contentRoot) │
│  - 翻译库: translate-cache/shared.sqlite   │ │  - 局内插件缓存 (可清理) │
│  - 旅伴库: companion-memory/companion.db   │ │  - 游戏原生存档 / 改包物 │
│  - 统一配置: game-agent/settings.json      │ └─────────────────────────┘
│  - 身份基线: game_identities (库内表)      │ ┌─────────────────────────┐
│  - 运行令牌: runtime/daemon.json           │ │ 浏览器桶 (Origin IDB/LS)│
└────────────────────────────────────────────┘ │  - 仅保留 UI 布局与 Token│
                                               └─────────────────────────┘
```

### 1.1 三桶职责与生命周期划分

| 落点         | 根路径                                     | 包含数据                                                                             | 生命周期与清理规则                                                                             |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **公共桶**   | `CHAYA_DATA_DIR`（打包为 `userData/data`） | 译文库、旅伴记忆库、统一 Agent 配置、游戏库元数据、离线包、下载作业快照              | **应用更新与覆盖安装必须保留**；用户显式选择“彻底清除用户数据”方可移除；禁止任何自动策略删除。 |
| **游戏内桶** | `<contentRoot>/chaya/`                     | 跟踪插件磁盘缓存（`plugins/`）、配置缓存、用户存入游戏内的存档（`saves/`）、改包回写 | **随游戏目录移动或丢弃**；`plugins/` 可随时清空重建；局内存档属用户数据，禁止静默随缓存清除。  |
| **浏览器桶** | 页面 Origin 作用域                         | 语言偏好、侧栏收起状态、窗口连接 Token、活动游戏暂存、FSA 句柄                       | **刷新即恢复，清站点可安全重建**；**严禁**存放译文、记忆、存档或 Agent 权威配置。              |

---

## 2. 数据库物理划分与 Schema 规范

为避免高频翻译查询与流式旅伴记忆归约（含配额 Compaction）产生 WAL 读写锁争用，**翻译与旅伴物理分库**。两库均位于公共桶，由单实例数据服务统一管理。

### 2.1 翻译库：`shared.sqlite`

库路径：`/translate-cache/shared.sqlite`。采用 Drizzle ORM + 原生 `DatabaseSync`。

```sql
-- 1. 本作独占译文表（区分游戏作用域，支持 Tombstone 屏蔽）
CREATE TABLE IF NOT EXISTS game_translations (
  game_id TEXT NOT NULL,
  src TEXT NOT NULL,
  src_lang TEXT NOT NULL DEFAULT 'ja',
  tgt_lang TEXT NOT NULL DEFAULT 'zh',
  zh TEXT,                                   -- NULL 表示 Tombstone（被显式删除或撤销）
  engine TEXT NOT NULL DEFAULT 'manual',     -- manual | agent | seed | import | google | ...
  category TEXT,                             -- dialogue | item | skill | menu | ...
  is_deleted INTEGER NOT NULL DEFAULT 0,     -- 1: Tombstone 标记，坚决阻断共享库回退
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, src, src_lang, tgt_lang)
);
CREATE INDEX IF NOT EXISTS idx_game_trans_lookup ON game_translations(game_id, src_lang, tgt_lang, is_deleted);
CREATE INDEX IF NOT EXISTS idx_game_trans_updated ON game_translations(game_id, updated_at);

-- 2. 跨游戏共享候选池（去重沉淀通用译文）
CREATE TABLE IF NOT EXISTS shared_translations (
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
CREATE INDEX IF NOT EXISTS idx_shared_trans_lookup ON shared_translations(src_lang, tgt_lang, nsfw);

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

-- 4. 写请求幂等审计表
CREATE TABLE IF NOT EXISTS mutation_log (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

#### 业务作用域与 Tombstone 屏蔽语义

1. **检索优先级链条**：  
   `game_translations` (命中且 `is_deleted = 0`)  
   → `game_translations` (命中但 `is_deleted = 1` 时**立即终止并返回未翻译，坚决阻断共享池**)  
   → `shared_translations` (跨游戏通用命中)  
   → 返回未命中。
2. **回流策略**：仅当本作译文为人工手改 (`engine = 'manual'`) 或经验证的高质量结果，且明确不包含专有占位符时，才异步沉淀至 `shared_translations`。

### 2.2 旅伴记忆库：`companion.sqlite`

库路径：`/companion-memory/companion.sqlite`。替代历史散落的 `companion-memory/<hash>/*.json`。

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

-- 4. 批次去重表（滑动窗口 256）
CREATE TABLE IF NOT EXISTS companion_applied_batches (
  batch_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, batch_id)
);
```

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

对以下文件进行内容归一化提取并计算 SHA-256：

1. `data/System.json`：提取 `{ gameTitle, versionId, startMapId, startX, startY, editDigest }`（排除动态修改字段）。
2. `data/Actors.json`：提取有效角色列表的前 8 个角色条目：`{ id, name, profile }`。
3. `package.json`：提取 `{ name, title }`。

#### RGSS (VX Ace / VX) 签名收集

1. `Game.ini`：提取 `[Game]` 小节下的 `Title` 与 `Scripts`。
2. `Data/System.rvdata2`（或 `Data/System.rvdata`）：提取前 16 KiB 二进制头与游戏内标题字段。
3. `Data/Actors.rvdata2`：提取前 8 KiB 二进制特征散列。

将上述归一化载荷使用 UTF-8 编码并通过 SHA-256 聚合为 64 位十六进制散列值。

### 3.3 签名比对与状态机

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
- **DRIFT（版本演进）**：标题匹配但核心数据散列发生小范围偏移（如打升级补丁、官方 DLC 或汉化脚本写回）。系统不自动变动 `game_id`，在控制台弹出提示并允许用户一键“确认版本更新并更新基线”。
- **MISMATCH（作品冲突）**：标题不符或散列全异。**强阻断公共资产读写**，避免将游戏 A 的记忆和翻译写入游戏 B。

---

## 4. 本机单实例数据服务架构

解决多进程（控制台、壳、多开游戏）直接并发 `sqlite.open` 导致抢写、锁争用与升级分叉的问题。

### 4.1 进程模型与生命周期

- **单实例范围**：严格绑定至规范化解析后的 ``。
- **按需拉起**：App、NW 壳、启动脚本均具备发现并拉起服务的能力。首个进程拉起服务；后启动进程握手复用。
- **窗口解耦**：控制台窗口关闭时，只要有游戏仍在游玩或仍有未落盘队列，数据服务继续在后台运行，直到所有客户端注销且经过 10 分钟空闲后优雅退出。

### 4.2 互斥锁定与防脑裂接管机制

服务实例通过 `/runtime/storage-daemon.lock` 维持单实例独占。

```text
尝试启动数据服务 ───▶ 打开 lock 文件 (O_EXCL / 独占锁)
                         │
        ┌────────────────┴────────────────┐
    [加锁成功]                         [锁已存在]
        │                                 │
  写入 PID + 启动时间 + 端口            读取锁内信息 (pid, startedAt)
  正常对外提供服务                        │
                                 OS 探测: process.kill(pid, 0)
                                          │
                         ┌────────────────┴────────────────┐
                     [PID 存活]                       [PID 已消亡]
                         │                                 │
                  原服务正常在线                    确认为孤儿残留锁
                  连接该端口并复用                  安全清除锁并接管
```

**核心不变量**：

1. **严禁仅凭 HTTP 探活超时就判定服务死亡**。长 GC 或系统休眠时旧进程并未交出文件句柄，强行删锁会导致脑裂双写。
2. 只有当 OS 底层明确返回 `ESRCH`（进程不存在）且锁文件内容陈旧时，才允许执行孤儿锁接管。

### 4.3 通信端点与认证

服务成功拉起后，在 `/runtime/storage-daemon.json` 发布握手凭证（文件权限 `0600`）：

```json
{
  pid: 48291,
  startedAt: 1729760000000,
  port: 3927,
  authToken: a4f8...6b2c,
  protocolVersion: 1,
  dataDir: /Users/davidjones/Develop/ops/apps/chaya/data
}
```

- **认证**：所有发往服务的请求头必须包含 `X-Chaya-Auth-Token`。
- **读操作**：客户端通过 `GET /api/storage/translations/snapshot?gameId=...` 一次性拉取本作与共享快照，驻留游戏内内存供同步查询；后续通过 SSE 连接订阅局部变更通知。
- **写操作**：客户端调用 `POST /api/storage/translations/commit`，请求体必须携带 `idempotencyKey`。服务在事务中原子写入译文表与 `mutation_log`，成功后广播变更。
- **服务不可用降级**：若数据服务暂时断开，客户端暂存变更于内存队列（标明 `pending`），**严禁**直接向游戏目录或浏览器写入假权威真源。

---

## 5. 升级、数据迁移与容灾流水线

废弃“默认导入重建”策略，确立**以版本化增量迁移为主、收束重构才走原子重建**的原则。

### 5.1 增量升级机制

- SQLite 原生维护 `PRAGMA user_version`。
- 字段追加、非空约束优化、新增索引一律由数据服务启动时在事务内执行 DDL，失败直接回滚，不得破坏既有库。

### 5.2 本波真源收束迁移清单

| 现有真源位置                               | 迁移目标                               | 迁移策略与约束                                              |
| ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| `contentRoot/chaya/translate/seed.json`    | `shared.sqlite -> game_translations`   | 按游戏 ID 归属，标记 `engine = 'seed'`。                    |
| `contentRoot/chaya/translate/cache.ndjson` | `shared.sqlite -> game_translations`   | 顺序解析行，保留最新修改时间、hitCount 与对齐信息。         |
| `data/translate-cache/shared.sqlite`       | `shared.sqlite -> shared_translations` | 原共享表无损映射保留，执行 DDL 升级补齐字段。               |
| `data/companion-memory/<hash>/`            | `companion.sqlite`                     | 顺序重放有效 checkpoint 与 journal batches，维护 epoch 序。 |
| `data/game-agent/settings.json`            | `data/game-agent/settings.json`        | 规范化为单 Profile 结构，移除未生效配置。                   |

### 5.3 严格废弃的遗留源（不迁移、不读、严禁反向覆盖）

以下位置包含历史碎片，升级后**直接废弃**，新逻辑不再读取或合并：

1. 浏览器 `IndexedDB`（`chaya-game-saves`、`chaya-agent-history`、`chaya-agent-activity`）。
2. 浏览器 `localStorage`（`chaya.gameAgent.*`）。
3. 操作系统旁路目录（`~/Library/Application Support/Chaya/game-agent.json`）。
4. 历史扁平文件（`*-trans.seed.json`, `shiru-trans.*`）。

### 5.4 六步原子迁移与自愈流水线

对现行翻译与旅伴资产的收束迁移必须保证“断电不坏、失败可逆”：

```text
[Step 1: 独占锁定] ──▶ 暂停外部写入与定时归约
        │
[Step 2: 物理快照] ──▶ VACUUM INTO 'shared.sqlite.bak-<timestamp>' (主库+WAL原子快照)
        │
[Step 3: 临时导入] ──▶ 构建临时库 'shared.sqlite.migrating'，批量执行数据转换
        │
[Step 4: 完整性校验] ──▶ PRAGMA integrity_check + 源目行数/摘要抽检对比
        │
        ├────────────【校验失败】────────────┐
        │                                   ▼
        ▼                            删除 .migrating 临时文件
[Step 5: 原子切换]                    恢复外部读写，上报并阻断
   连接关闭 ──▶ renameSync(原库, 原库.archive) ──▶ renameSync(新库.migrating, 新库)
        │
[Step 6: 状态固化] ──▶ 记录 migration_success，向旧游戏目录写入 .migrated 标记
```

#### 中断自愈规则

服务启动时检测目录状态：

- 若存在 `.migrating` 临时文件：说明上次迁移发生崩溃或掉电。服务**立即安全删除 `.migrating` 文件**，回退至原始库重新评估，**严禁将残缺中间库作为新库加载**。
- 若存在 `.bak` 备份但原库损坏：提供一键从 `.bak` 还原的自愈入口。

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
  ├── 1.1 实现单实例数据服务进程骨架与 O_EXCL 文件锁协议
  ├── 1.2 实现 shared.sqlite 与 companion.sqlite 的 DDL 与 Drizzle Schema
  └── 1.3 实现游戏身份内容签名算法 (MV/MZ + RGSS) 与基线存储

Phase 2: 迁移流水线与服务化读写 (T1)
  ├── 2.1 实现带有快照备份与自愈检测的原子迁移流水线
  ├── 2.2 实现局内 translate/* 到 shared.sqlite 的迁移转换器
  ├── 2.3 实现 companion-memory JSON 重放至 companion.sqlite
  └── 2.4 提供本地 HTTP/IPC 变更提交与 SSE 变更通知接口

Phase 3: 客户端接线与旧路径切除 (T2)
  ├── 3.1 改造 NW 插件 Translator 运行时：从本地读取切换为拉取服务快照
  ├── 3.2 改造 Companion Host：持久化后端直连本地服务接口
  ├── 3.3 切断 OS game-agent.json 与浏览器 IDB 的双写/回填通道
  └── 3.4 游戏目录标记已迁移状态，移除局内老写逻辑
```

---

## 8. 验证计划与测试矩阵

验收必须通过以下 8 项关键容灾测试：

1. **多进程并发拉起**：同时拉起控制台 App 与 3 个游戏壳，验证只有 1 个成为数据服务主控，其余 3 个全部正常握手连接，无锁死。
2. **窗口生命周期分离**：启动游戏后关闭控制台窗口，游戏内继续触发未翻译对话与记忆事件，验证数据正常落盘。
3. **异常中断孤儿锁接管**：对运行中的服务进程执行 `kill -9`，新客户端能在确认 PID 死亡后安全清除锁并重新拉起服务。
4. **假死抗争防护**：模拟服务进程长暂停（`SIGSTOP`），新进程探测到 PID 仍然存活，拒绝抢锁接管，防止脑裂。
5. **原子迁移中途断电**：在数据迁移执行到 50% 时强制退出进程，重启后验证 `.migrating` 临时文件被安全丢弃，原始数据毫秒级回滚。
6. **游戏身份漂移与隔离**：
   - 游戏目录改名：验证稳定 Game ID 保持不变，通过绝对路径重定向继续生效。
   - 覆盖安装补丁：验证触发 DRIFT 提示，用户确认后平滑更新基线。
   - 换入完全不同的游戏目录：验证触发 MISMATCH 强阻断，拒绝污染旧资产。
7. **Tombstone 屏蔽有效性**：在游戏内删除一条译文，验证该条目在 `game_translations` 记录为 Tombstone，后续翻译检索坚决不从共享库复活该词。
8. **服务离线内存缓冲**：在数据服务宕机期间进行游戏，客户端将写入积压在内存队列，服务重新拉起后重发补录，无数据遗漏。
