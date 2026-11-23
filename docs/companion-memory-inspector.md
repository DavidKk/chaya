# 旅伴记忆与客观事件审计面板需求

> 有效性：草案；实现进度：未实施；2026-11-12。  
> 关联需求：[`companion-memory.md`](companion-memory.md)（记忆模型与采集基线）、[`companion.md`](companion.md)（旅伴系统总则）。  
> 关联技术方案：[`technical/companion-memory-inspector.md`](technical/companion-memory-inspector.md)、[`technical/companion-memory.md`](technical/companion-memory.md)。  
> 对齐：默认周目、暂停与清理以 [`companion-memory.md`](companion-memory.md) §6、§11 为准。本文只定义审计面板，不改记忆内核。  
> 页面落点：Web 控制台 `AI` 模块 `/ai/memory`。

---

## 1. 背景与痛点

旅伴把战斗胜负、击倒、读档、存档和里程碑归约进 `companion.sqlite`。目前没有页面阅读这些记录，排查要直接打开数据库或日志。

因此在 **AI** 下增加二级页面 **「游玩记忆」**，集中查看当前游戏、当前周目的客观记录，并提供暂停与按游戏清理。

本页不解决「模型回复是否幻觉」。它只展示规则归约后的记录；模型建议、提示词和对话仍在旅伴面板。

---

## 2. 目标与非目标

### 2.1 目标

1. **当前周目时间线**：倒序展示该周目已提交的战斗结果、击倒、读档、存档和里程碑。
2. **同一周目的敌人统计**：遭遇、胜负和已记录的危险技能按敌人聚合，次数不跨周目相加。
3. **证据核对**：展开单条经历的 `ActionEvidence`、HP、完整度和 `sourceEventIds`。
4. **生命周期**：展示选中游戏的逻辑占用、记录开关，以及带确认的按游戏清理。
5. **文案走 i18n**：组件不写死中文。新键进入 `MessageTree`，已有 locale 都要有条目。

### 2.2 非目标

1. **不做聊天或托管**：实时对话仍在局内悬浮面板。
2. **不改单条事实**：只提供整段清理和暂停/恢复，不允许改一条经历的伤害或技能。
3. **不展示模型内容**：不显示提示词、模型回复，也不做「幻觉和脏事实」对照。
4. **不新造记忆种类**：面板消费现有经历 kind 与 `battleRecording`，不把域事件改写成新的经历类型。

---

## 3. 用户场景

| 角色          | 场景                                           | 结果                                                            |
| ------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 玩家          | 查看旅伴对这一周目记住了什么，或刷级时暂停记录 | 看到当前周目战绩；暂停后新经历不再写入；需要时清空该游戏记忆    |
| 创作者 / 玩家 | 确认某次击倒记下了哪一招                       | 在当前周目的敌人卡片和击倒证据里查看技能与 HP                   |
| 开发者        | 核对采集是否完整                               | 看到 `completeness`、来源事件 ID 和已保存字段；未知归因保持未知 |

---

## 4. 功能需求

### F1. 导航与游戏范围

- 在 `components/ai/ai-sections.ts` 的 `AI_SECTIONS` 增加 `id: 'memory'`。`AiShell` 按 `/ai/${id}` 生成路径，所以页面是 `/ai/memory`，并继续转发已有的 `?game=`。现有分区只有 `companion` 与 `agents`。
- 文案键新增，例如 `nav.companionMemory`，必须先进入 `MessageTree`。
- `?game=` 是游戏库条目的 `libraryGameId`，与 `GET /api/game-agent/memory?gameId=` 使用同一个值。记忆接口不列举游戏。下拉数据来自现有游戏库。
- 没有 `libraryGameId` 时不请求记忆接口。空 `gameId` 会得到 400 `GAME_ID_REQUIRED`。
- 条数和逻辑占用只显示当前选中的游戏，由该游戏快照估算，并对照单游戏 20 MiB 预算。不为下拉里的每个游戏各拉一份快照。占用不是进程内存。`memoryEpoch` 是清理屏障版本，清理时加一，不用它表示容量或代数。
- 记录灯读取 `recordingEnabled`。暂停/恢复使 `recordingRevision` 加一。
- 现有 GET 把 `status.persistence` 固定写成 `ready`，面板不能靠这个字段判断降级。非本机磁盘环境返回 404 `LOCAL_ONLY`。
- 「实时」是每 3 秒重新 GET 整份快照并替换视图。它不是增量流，也不保证下一拍出现刚结束的战斗。采集是异步落盘的。

### F2. 暂停、恢复与清理

语义与 [`companion-memory.md`](companion-memory.md) §11 一致。

- **暂停**：`action: 'set_recording'` 且 `enabled: false`。已提交记录保留。尚未提交的队列作废，不补进页面，恢复后也不追补暂停区间。暂停提交前已通过版本检查的批次仍可能写入。验收以管理结果里的 `recordingEnabled === false` 和更高的 `recordingRevision` 为准。
- **恢复**：`enabled: true`。从当前现场重新采集，不回填暂停期间。
- **清理**：`action: 'clear'`。`preferences: true` 表示删除该游戏偏好；勾选「保留偏好」时省略该字段或传 `false`。`episodes` 不为 `false` 时删除该游戏的 episodes、evidence、saveLinks、projections，并清空该游戏的 `battleRecording`。清理使 `memoryEpoch` 加一，待写队列和旧重试失效。不删除游戏存档和 Agent 活动日志，其它游戏不变。

### F3. 时间线

- 默认只显示一个周目。快照没有「当前周目」字段，默认用该游戏最新一条经历的 `playthroughId`，并标明「最近周目」。其它周目要用户显式选择，卡片带周目和分段徽章。运行状态若以后提供进行中的 `playthroughId`，再改作默认。
- 快照本身包含该游戏已保存的各周目。过滤在前端做。胜率不得把多个周目加总后当作当前周目的次数。
- 经历 kind 为 `battle_result`、`knockout`、`load`、`save`、`milestone`。`battle_result.outcome` 只有 `win`、`lose`、`escape`、`abort`。剧情允许失败是战斗结果域事件上的 `canLose`，不是第五种 outcome；当前经历记录不保存 `canLose`，面板不得从 `summary` 推断。
- `defense_attempt` 只在契约里，当前采集不单独产出，不作为必须出现的卡片。`battle_start` 与 `admin` 不是经历 kind：战斗开始在 `battleRecording` 的 `encounter_started`，管理动作不进时间线。
- 筛选：当前周目内的全部、战败、胜利、逃跑、中止、读档、存档、里程碑，以及显式的周目 / 分段。文本过滤只匹配已加载快照中的名称。
- 列表超过首屏时分页或「加载更多」。不要求一次挂载该游戏的全部 DOM。

### F4. 敌人统计

- 统计与时间线使用同一个周目。`MemoryProjectionStats.key` 含 `playthroughId`，聚合时保持这个键。
- 卡片展示敌人 ID / 名称、遭遇、胜、败，以及该周目证据里出现过的技能。
- 点击敌人只过滤当前周目时间线中与该敌人相关的经历。

### F5. 证据抽屉

- 点击经历，从侧边打开已保存字段。
- 完整度展示 `complete_for_claim`、`partial` 或 `unknown`。HP 允许为 `null`。`attribution: 'unknown'` 保持未知，不补攻击者或技能。
- 展示 `segmentId`、`encounterId`、`linkedFrom` 和 `sourceEventIds`。复制出去的 JSON 是已存储的经历 / 证据，不是重建后的完整战斗。

### F6. 空态与本机限制

- 选中的游戏没有当前周目记录时，说明启动游戏并产生已提交事件后才会出现。未落盘的战斗不算已出现。
- `canUseDisk()` 不成立时接口返回 404 `LOCAL_ONLY`。页面显示本机持久化不可用，并停止轮询。

---

## 5. 验收

1. `/ai/memory` 出现在 AI 侧栏。`?game=` 为游戏库 `libraryGameId`。没有该参数时不请求记忆接口。
2. 一场已提交的胜利、一次击倒和一次成功读档，能在对应周目里看到 `battle_result`、`knockout`、`load`。`partial` / `unknown`、裁剪后的证据和未知归因保持原样，不要求与战斗结算逐字段相同。
3. 暂停的管理调用返回后，`recordingEnabled` 为 false，且 `recordingRevision` 增大。此后新采集不再写入；已提交记录还在；暂停区间不会在恢复后补录。
4. 「保留偏好」的清理使该游戏经历、证据、存档关联、投影和 `battleRecording` 消失，偏好还在，`memoryEpoch` 增大，其它游戏不变。`preferences: true` 才同时删除该游戏偏好。过期写入不能把已删记录写回。
5. 抽屉能看到已存的技能 ID、HP 和完整度；复制结果是该条已存 JSON。
6. 切换语言后，本页新增文案都来自 i18n。各已有 locale 都有对应键。
7. `LOCAL_ONLY` 时显示本机限制说明，并停止 3 秒整份快照轮询。
