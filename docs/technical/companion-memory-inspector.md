# 旅伴记忆与客观事件审计面板技术方案

> 有效性：草案；实现进度：未实施；2026-11-12。  
> 需求：[`../companion-memory-inspector.md`](../companion-memory-inspector.md)  
> 记忆内核：[`companion-memory.md`](companion-memory.md) §8；需求侧默认周目、暂停与清理见 [`../companion-memory.md`](../companion-memory.md) §6、§11。  
> 现有接口：[`app/api/game-agent/memory/route.server.ts`](../../app/api/game-agent/memory/route.server.ts)。  
> 页面落点：`app/ai/memory/page.tsx`、`components/ai/memory/*`。

本面板只读现有快照，并调用现有 `manage`。不改经历 schema，不把 `canLose`、`battle_start` 或 `admin` 补成新的经历 kind。

---

## 1. 数据流

```text
游戏库选中 libraryGameId
        │
        ▼
GET /api/game-agent/memory?gameId=<libraryGameId>
        │
        ▼
该游戏的 MemoryStoreSnapshot（含已保存的各周目）
        │
        ▼
前端滤到一个周目后渲染时间线、敌人统计、证据抽屉

暂停 / 清理 ── POST action=manage（携带 epoch 与 recordingRevision）──▶ CAS
```

实时模式每 3 秒重复上面的 GET，用新快照替换视图。没有服务端增量或推送。刚结束的战斗要等该批次提交后才会出现。

---

## 2. 复用的接口

### 2.1 快照

`GET /api/game-agent/memory?gameId={libraryGameId}`

- `gameId` 与页面 `?game=` 相同，都是游戏库条目 id。记忆接口不提供游戏列表；列表用现有游戏库。
- 缺省或空白 `gameId` 返回 400 `GAME_ID_REQUIRED`。页面在有 id 之前不发这个请求。
- 成功体为 `{ ok: true, data: { snapshot, status } }`。`snapshot` 为该游戏整库，包含多个 `playthroughId` 时都在里面。默认视图再滤到一个周目。
- `status` 当前只有 `memoryEpoch`、`recordingRevision`、`recordingEnabled`、`episodeCount`，且 `persistence` 固定为 `ready`。逻辑占用用快照估算，不读取一个不存在的 `status.usedBytes`。降级不看这个 `persistence`。
- `!canUseDisk()` 时返回 404 `LOCAL_ONLY`。页面展示本机限制并停止轮询。

`memoryEpoch` 是清理屏障。只有 `clear` 使它加一。`recordingRevision` 在 `set_recording` 时加一。二者都不是进程内存代数，也不是容量单位。单游戏逻辑预算是 20 MiB，见 [`companion-memory.md`](companion-memory.md) 的容量表。

### 2.2 管理

`POST /api/game-agent/memory?gameId={libraryGameId}`，`action: 'manage'`。

`validateMemoryManagement` 要求非空 `requestId`、`expectedMemoryEpoch`、`expectedRecordingRevision`。版本不符时返回 409，前端先重新 GET 再决定是否重试。过期批次不能写回已清理的记录。

暂停：

```json
{
  "action": "manage",
  "gameId": "<libraryGameId>",
  "management": {
    "requestId": "<unique>",
    "expectedMemoryEpoch": 1,
    "expectedRecordingRevision": 1,
    "action": "set_recording",
    "enabled": false
  }
}
```

恢复把 `enabled` 设为 `true`。暂停使记录修订加一，并作废尚未提交的旧队列：那些事件不保证写入，也不在恢复后补录。已提交记录保留。管理事务提交前已通过版本检查的批次仍可能落盘。

清理body：

```json
{
  "action": "manage",
  "gameId": "<libraryGameId>",
  "management": {
    "requestId": "<unique>",
    "expectedMemoryEpoch": 1,
    "expectedRecordingRevision": 1,
    "action": "clear",
    "preferences": false,
    "episodes": true
  }
}
```

`preferences: true` 删除该 `libraryGameId` 的偏好。保留偏好时省略 `preferences` 或传 `false`。`episodes` 不为 `false` 时删除该游戏的 episodes、evidence、saveLinks、projections，并 `recording.clear(gameId)` 清掉 `battleRecording`。清理同时使 `memoryEpoch` 加一。游戏存档和 Agent 活动日志不在这次删除里。

---

## 3. 前端模块

`AI_SECTIONS` 现有 `companion`、`agents`。新增 `{ id: 'memory', labelKey, icon }` 后，`AiShell` 得到 `/ai/memory`，并沿用 `?game=`。`labelKey` 先加入 `MessageTree`。

```text
app/ai/memory/page.tsx
components/ai/ai-sections.ts
components/ai/memory/
  AiMemoryRoute.tsx
  MemoryHeaderBar.tsx
  MemoryTimelineView.tsx
  MemoryEpisodeCard.tsx
  MemoryDossierView.tsx
  MemoryEvidenceDrawer.tsx
  MemoryClearConfirmDialog.tsx
```

### 3.1 容器

- 读取 `game`。无值时不请求记忆接口。
- 快照没有当前周目字段。默认用最新一条经历的 `playthroughId`，标题写明「最近周目」。用户再选其它周目。
- 筛选只作用于这个周目：`battle_result` 的 `win` / `lose` / `escape` / `abort`，以及 `knockout`、`load`、`save`、`milestone`。
- 实时开关打开时，每 3 秒 GET 整份快照。请求被替换或页面卸载时取消上一笔。

### 3.2 卡片

- `battle_result` 按 `outcome` 显示胜利、战败、逃跑、中止。不从 `summary` 推导「剧情允许失败」。`canLose` 没有写入 `MemoryEpisodeRecord`。
- `knockout` 显示已存的目标、技能和 HP；缺字段就显示未知。
- `load` / `save` 显示分段和存档来源。`milestone` 只显示已存的 `details`。
- `defense_attempt` 遇到才渲染。当前采集不单独产出它，验收不依赖这种卡片。
- 完整度徽标覆盖 `complete_for_claim`、`partial`、`unknown`。

### 3.3 统计与抽屉

- 统计只累加当前 `dataRevision` + `playthroughId` 的 `projections`。技能名从同一范围内经历的 `evidence.ability` 读取。
- 抽屉展示已存的 `ActionEvidence`、`linkedFrom`、`sourceEventIds`。复制按钮写入这条已存 JSON。HP 和归因可以是空或 `unknown`。

---

## 4. 渲染与一致性

快照按游戏返回，条数受 20 MiB 逻辑预算和内核侧默认 4096 条经历上限约束，页面不把其中任何一个写成「500ms 渲染全部卡片」。前端先按周目过滤，首屏只挂载一部分，其余用「加载更多」。

管理成功后使用返回的 `memoryEpoch` 与 `recordingRevision`。与本地持有的版本不一致时重新 GET，再画时间线。

---

## 5. 文案

新键放在 i18n 的记忆命名空间，并写入 `MessageTree`。zh / en 写完整句子；ja、ko、cht 以及其余已有 locale 至少有可用译文，缺键不能通过类型检查。组件通过 `t()` 取文案。

建议键：标题、记录中、已暂停、暂停说明、恢复说明、清空标题与范围说明、保留偏好、时间线、敌人统计、各筛选、三种完整度、复制、空态、本机不可用。清空说明要写明删除经历、证据、投影、读档关联和战斗记录；保留偏好时不删除偏好；不删除存档和活动日志。

---

## 6. 实施与验证

1. 注册 `memory` 分区、页面和文案键。
2. 接上快照、当前周目过滤和卡片。
3. 接上同一周目的统计与证据抽屉。
4. 接上暂停、恢复和清理确认，带上 CAS 版本。

验证：

- 有记录的游戏能画出当前周目里已提交的胜负、击倒和读档；完整度与 HP 空值保持原样。
- 点击敌人后，时间线只剩该周目中与该敌人相关的经历，统计不混入其它周目。
- 复制结果是已存证据 JSON。
- 暂停返回后 `recordingEnabled === false`，修订号增大；之后的新经历不写入，暂停段不补录。
- `preferences: false` 的清理清掉该游戏经历、证据、关联、投影和 `battleRecording`，偏好和其它游戏还在，`memoryEpoch` 增大。
- `LOCAL_ONLY` 时停止轮询并显示本机限制。
