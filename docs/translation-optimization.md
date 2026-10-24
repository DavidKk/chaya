# 翻译优化（专名/术语优先，闲时润色其次）需求文档

- 日期：2026-10-24
- 状态：一期已落地（列表/原文入口、scan / apply-terms / short-entities、live:optimize 秩）；实机与闲时全库润色未验收
- 关联文档：[翻译调度优化基线](translation-scheduling.md)、[翻译管线核心设计](technical/translation-pipeline.md)、[翻译缓存语义分段与优化需求](translation-cache-optimization.md)
- 关联技术方案：[翻译优化与闲时调度技术方案](technical/translation-optimization.md)
- 按需定位：UI §3；专名漏斗 §2.4；**入口与冲突 §5**；一期范围 §6；现状差距 §7。

## 1. 背景与核心问题

1. **菜单/系统词机械直译**：Save→节省、Load→负荷 等，可用内置术语零成本纠正。
2. **短专名翻车重于长句**：人物、物品、地名、选项短、量可控，却最伤观感；长句机翻仍有用途，不宜全库精翻一把梭。
3. **多入口并存**：控制台、插件局内、seed/sources 作业、实时对白、CLI、人工保存可同时读写；优化必须按入口写清职责，禁止阻塞实时路径、禁止与补译无序互踩。
4. **现有「优化」易混名**：翻译库条目详情里的「优化」指**分段映射确认**，与本需求「专名/术语质量作业」不是同一功能，产品文案必须区分。

## 2. 核心目标与产品原则

### 2.1 游戏术语（Game Terms）零成本纠偏

- 扩展内置 `GAME_TERMS`（Save/Load/Item/…）。
- 一键 `apply-terms`：只改已知劣质机翻词，不调模型。

### 2.2 专名 / 短文本优化（一期主交付，与全库润色分离）

- **范围（与列表「名称」对齐，另含选项）**：
  - 名称类：`actor` / `item` / `weapon` / `armor` / `skill` / `enemy` / `state` / `map`（与 `natureFilter === 'name'` 一致）
  - 选项：`choice`（剥 `choice-meta` 壳后优化净文本）
  - 一期**不含**：`dialogue` / `story`、长 `*_desc` / `actor_profile`；`actor_nickname` 可并入名称类短文本（单行且短）
  - 长度：逻辑文本建议 ≤40 字且单行（实现可调常量）
- **候选来源**：必须 **`extract-items`（带 `meta.category`）⋈ 本作译文记录**；禁止只扫无 category 的 ndjson/shared。
- **漏斗**：L1 术语表 → L2 短文本作业（本地 Agent + category prompt 优先）→ 句子路径仅 mask/unmask 已确认专名（二期可做，一期可先不做 mask）。
- **产品拆分**：「优化名称」≠「优化已译 / 闲时润色」≠ 翻译库「分段优化」。

### 2.3 守秩与引擎标记（硬约束，修正旧表述）

现行 `manual:optimize` 秩为 **0**，**不能**升级已有 `live:*`（1），反会被后续 live 覆盖——不可再用该标记作为专名定稿。

| 写入场景             | 引擎标记                                    | 秩要求                                                      | 行为                                                         |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| 人工保存             | `manual`                                    | 4                                                           | 优化永久跳过                                                 |
| 导入                 | `import` / `import:*`                       | 3                                                           | 跳过                                                         |
| 专名/术语优化成功    | `live:optimize`（或 `live:agent:optimize`） | **≥ 2**（与 `live:agent` 同档或专用档，须 ≥ 普通 `live:*`） | 可替换低质 `live:*` / `live:google` 等；不可盖 manual/import |
| 普通机翻             | `live:*`                                    | 1                                                           | 可被优化升级                                                 |
| 旧 `manual:optimize` | 0                                           | 遗留                                                        | 新写入禁止；迁移策略见技术方案                               |

冲突：同键写失败则 **skip + 计数**，不死循环重试。

### 2.4 闲时与全库润色（二期）

- 全库 polish 严格 idle；与专名作业同队列时专名优先。
- 实时对白绝对优先：优化停派发、让配额。

## 3. 控制台 UI（一期）

顶栏 Tab 不变：`原文 | 列表 | 游玩 | 翻译工具 | 翻译库 | …`。

### 3.1 主入口：列表（`/translate/list`）

- 性质筛到 **「名称」**（及可选 **「选项」**）时，工具条主按钮：**优化名称**。
- 未筛选时也可放次要入口；点击后先 `scan` 预览候选数（按 category），确认再跑，避免误以为扫全库。
- 运行中：列表顶或工具条显示进度 / 暂停原因（如「游玩翻译进行中，已让路」）；不阻塞列表编辑与人工保存。
- **不**在「翻译工具」页放入口；**不**新开顶栏 Tab。

### 3.2 次入口：原文（`/translate/seed`）任务条

- 与「批量翻译 / 补译」并列次要动作：**优化名称**。
- 语义：补译出初稿之后的质量步骤；**默认不**在补译结束后自动 enqueue（开关默认关）。

### 3.3 禁止混用

| 位置               | 行为                                                       |
| ------------------ | ---------------------------------------------------------- |
| 翻译库条目「优化」 | 保持分段映射语义；文案勿改成「优化名称」；至多链到列表说明 |
| 游玩               | 不发起 L2；最多只读提示后台状态                            |
| 翻译工具           | 仅引擎/并发配置                                            |

### 3.4 典型场景

| 场景         | 用户                   | 系统                                              |
| ------------ | ---------------------- | ------------------------------------------------- |
| 看名称翻车   | 列表 → 名称 → 优化名称 | scan → apply-terms → short-entities；列表译文更新 |
| 汉化流水线   | 原文补译后点优化名称   | 同作业；不拖死补译                                |
| 游玩中误点   | 已开优化               | 停派发、UI 显示让路；对白不卡                     |
| 人工改过的名 | 已保存                 | 扫描跳过，报告 skippedManual                      |

## 4. 边界与非目标

- 一期不重建 shared SQLite；允许加法迁移可选 `category` 列，并扩展引擎秩映射。
- 不破坏控制码；不覆盖 manual/import。
- 默认不耗商业 API；本地 Agent / 离线优先。
- 未在 §5 列出的入口：只读术语命中，不发起优化作业。

## 5. 全入口矩阵：职责、阻塞与冲突

优先级：**人工定稿 > 实时对白/游玩 > seed/sources 补译 > 专名优化 > 全库润色**。

### 5.1 硬性规则

1. **实时路径禁止同步跑 L2**：对白 / `realtime` / `interactive` 只 lookup → 机翻。
2. **优化可抢占**：live 在途或冷却窗内停派发；已发出单条可结束或 Abort，不拖对话。
3. **守秩按 §2.3**：用 `live:optimize` 档替换低质 live；manual/import 跳过。
4. **优化只挂服务端** `mode: optimize`；插件不第二套优化循环。
5. **跨进程算力**：插件 job 与服务端优化不共享 `withEngineCapacity`。一期：优化默认使用**不与插件实时抢同一本地模型**的策略（优先术语-only，或用户显式选 Agent 且 UI 警告「游玩/补译中请暂停优化」）；二期再做心跳上报统一 idle。
6. **只读入口零副作用**：lookup / cache 读 / GameEdit / RGSS / benchmark。
7. **Live 活跃计数必须接线**：凡服务端 `liveTranslateTexts` 与计入实时的 API 须 `trackLiveTranslateRequest`；`short-entities` / `batch-optimize` **强制** `assertOptimizeMayDispatch`，禁止只靠 UI 查 idle-status。

### 5.2 入口一览

| 入口                                | 对专名/优化                        | 可阻塞该入口？         | 冲突处理                                 |
| ----------------------------------- | ---------------------------------- | ---------------------- | ---------------------------------------- |
| 列表 UI「优化名称」                 | 调服务端 optimize（主入口）        | 否（异步作业）         | 见硬性规则                               |
| 原文 UI「优化名称」                 | 同上（次入口）                     | 否                     | 同上                                     |
| 插件局内实时对白 / 字幕             | 仅 lookup                          | **否**                 | 触发则优化让路；插件 Ollama 队列 preempt |
| `/api/translate` 默认 texts         | 不跑优化作业                       | **否**                 | 须 track live；与优化同进程则占容量      |
| `mode: realtime`                    | 不跑优化                           | **否**                 | 计入 live                                |
| 插件 `mode: job`                    | 不跑优化；可命中已优化术语         | 补译可慢，不被优化拖死 | 优化让路；ndjson 锁；秩冲突 skip         |
| 服务端 seed-job                     | 不内嵌优化                         | 否                     | 同进程容量；优化不可压过更高权威         |
| `mode: seed` 单批                   | 不触发                             | 否                     | 短请求                                   |
| `mode: sources`                     | 导入结束后可选显式 enqueue，默认关 | 导入不等优化           | 导入优先                                 |
| `mode: optimize` scan / apply-terms | scan 只读；apply 零模型            | 不得等引擎             | 守秩 skip                                |
| `mode: optimize` short-entities     | L2 作业                            | 可被打断               | 与 polish 互斥全速；专名优先             |
| `mode: optimize` batch-optimize     | 二期全库润色                       | 可被打断               | 排在专名后                               |
| lookup / cache 读                   | 只读                               | 否                     | 无                                       |
| 单引擎 ai/apple/bergamot            | 不触发作业                         | 否                     | 占容量                                   |
| save-item / PATCH manual            | 最高权威                           | 否                     | 优化跳过                                 |
| extract / 重建 seed                 | 不跑优化；指纹变则重扫候选         | 否                     | 不自动重跑 Agent                         |
| translate-cache 分段「优化」        | **另一功能**                       | 否                     | 文案区分                                 |
| GameEdit / RGSS                     | 只读                               | 否                     | 无                                       |
| `import-locales-corpus`             | 不自动优化                         | 否                     | 导入优先                                 |
| Cloud/remote 无盘                   | 优化不可用或明确禁用               | —                      | UI 说明                                  |
| CLI                                 | 可选专名开关                       | 可阻塞 CLI 自身        | 与控制台并存时警告                       |
| MCP                                 | 同 mode；polish 须异步             | 否                     | 同服务端规则                             |

### 5.3 验收

1. 列表「名称」下优化名称：候选无 dialogue；完成后名称类译文改善且 manual 行不变。
2. 游玩对白期间开优化：对白不卡；UI 显示让路；结束后可恢复。
3. 已有 `live:*` 劣译可被 `live:optimize` 升级；其后普通 live 不得无故盖回劣译（秩）。
4. `apply-terms` 秒级返回，不进引擎队列。
5. RGSS / GameEdit / lookup 零写零优化副作用。

## 6. 一期开工范围（MVP）

**做：**

1. 候选：extract-items ⋈ 译文 + 名称/选项过滤 + 长度。
2. API：`scan(scope:short-entities)`、`apply-terms`、`short-entities`（可暂停）+ 强制 idle 门闩；live 路径接线 `trackLiveTranslateRequest`。
3. 写回：`live:optimize` 秩 ≥ live；双写 shared（能接受则写）+ 本作 ndjson；跳过 manual/import。
4. UI：列表主按钮 + 原文次按钮；进度/让路提示。

**不做（二期）：**

- 全库 `batch-optimize` 产品化、闲时自动跑。
- 句子 mask/unmask 全路径。
- 插件→服务端 live 心跳统一 idle。
- 新顶栏 Tab、engines 页入口。

## 7. 现状差距（实现前必须消掉）

| 差距   | 现状                                        | 一期要求                     |
| ------ | ------------------------------------------- | ---------------------------- |
| 秩     | `manual:optimize`=0，升不了 live            | 改用 `live:optimize` 且秩 ≥2 |
| 候选   | 只扫无 category 的 records                  | 接 extract-items             |
| Idle   | track 未进 liveTranslate；batch 不检查 idle | 接线 + 强制门闩              |
| UI     | 无「优化名称」                              | 列表/原文按 §3               |
| 跨进程 | 插件与服务端容量分离                        | §5.1.5 策略 + 文案警告       |
