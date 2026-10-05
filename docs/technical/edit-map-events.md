# 修改：地图与公共事件技术方案

> 状态：实施中（第 1 期数据层、协议、link 分片已完成，UI 未接入）
> 日期：2026-10-05
> 需求：[`../edit-map-events.md`](../edit-map-events.md)
> 关联：[`chaya-ui-style-guide.md`](./chaya-ui-style-guide.md)、[`../capabilities.md`](../capabilities.md)、[`../run-modes.md`](../run-modes.md)

## 1. 决策

- **一份解析，三处取数**：事件数据的结构化（名称表、指令规范化、引用关系、副作用摘要、解释器）全部放在纯函数模块 `lib/game/events/`，不依赖 Node / DOM。local 服务、游戏内插件各自只负责「拿到原始 JSON + 译名查表函数」，再调用同一个 `buildCommonEventsData`。
- **解释器输出结构化行，不输出文案**：`interpretCommands` 返回 `ScriptLine[]`（i18n key + 参数 + 色调 + 链接），由 React 组件按当前语言渲染。插件、控制台、四种语言共用，不在数据层拼中文。
- **操作只走现有通道**：执行公共事件、传送等复用 `edit.cmd` / `edit.ack` 协议与 `Cheats.*`，不新开 RPC；Agent 继续只用 `chaya_edit_action`，不新增工具。
- **数据按页懒加载**：「修改」其余分类走 `edit.catalog`；事件数据体积大（需扫全部地图），单独走 `edit.events`，只在进入「公共事件 / 地图」时请求。
- **撤销放在插件侧**：快照栈保存在游戏进程内存，控制台只发 `undo` 指令；这样网页断线重连、局内浮层与网页同时打开时状态一致（第 3 期）。

## 2. 总体架构

```text
修改 › 公共事件 / 地图（components/game-edit，page 与 overlay 共用）
  │
  ├─ page（/cheat/common、/cheat/map）
  │    ├─ 已连接游戏：link → edit.events.request → edit.events
  │    └─ 未连接（local）：GET /api/game-edit/events
  │
  └─ overlay（plugins/src/cheat/ui/App.tsx）
       └─ buildLiveCommonEventsData()（进程内直接构建）

数据构建（同一份纯函数）
  services/game/game-edit-events.ts        读盘 + 翻译库查表
  plugins/src/cheat/session/live-events.ts $data* + XHR data/MapXXX.json + tName
        ↓ RawEventSources
  lib/game/events/build.ts → CommonEventsData
  lib/game/events/interpret.ts → ScriptLine[]（组件渲染时调用）

操作
  UI → sendCmd({ op: 'commonEvent', id }) → edit.cmd → remote-bridge.applyEditCmd
     → runCommonEventOnMap → Cheats.runCommonEvent → edit.ack { ok, error? }
```

edge 模式没有服务端读盘：已连接游戏时与 page 相同走 link；未连接时第 1 期显示「连接游戏后可浏览」，浏览器授权读盘（`lib/browser/fsa.ts`）放到第 2 期再接。

## 3. 模块落点

```text
lib/game/events/                       # 纯函数，无 IO
  types.ts       EventCommand / CommonEventInfo / EventRef / EventNames / CommonEventsData   ✅
  build.ts       RawEventSources → CommonEventsData；normalizeCommands；calledBy 引用表      ✅
  effects.ts     summarizeEffects / isRiskyEffects / hasEffects                             ✅
  interpret.ts   interpretCommands → ScriptLine[]；ScriptKey ↔ i18n events.cmd.*            ✅
  groups.ts      公共事件分组识别（分隔名 → 组标题）                                          ☐ 第 1 期
  map-index.ts   MapInfos 树、入口（201）、事件类型推断、各图事件名（跨图搜索用）              ☐ 第 2 期
  index.ts       barrel                                                                     ✅

services/game/game-edit-events.ts      # local 读盘 + 翻译、按文件 mtime / 大小缓存、mapsFailed ✅
app/api/game-edit/events/route.server.ts  GET，requireDisk                                  ✅
app/api/game-edit/map/route.server.ts     GET ?id=，单张地图详情                             ☐ 第 2 期

lib/runtime/game-link-protocol.ts      # op commonEvent、ack.error、edit.events(.request)   ✅
lib/runtime/link-chunks.ts             # 通用分片 / 重组（`link.chunk`），edit.events 已接入 ✅
lib/runtime/game-edit-sync.ts          # commonEvent 的 ack 期望值                          ✅
plugins/src/cheat/session/live-events.ts  # 局内构建 + runCommonEventOnMap                 ✅
plugins/src/cheat/session/remote-bridge.ts # 处理 commonEvent 与 edit.events.request        ✅

components/game-edit/
  events/EventScript.tsx           解释器渲染（缩进、折叠、链接、原文悬停）                  ☐ 第 1 期
  events/CommonEventsPane.tsx      列表 + 详情（宽屏分栏 / 窄屏逐层）                        ☐ 第 1 期
  events/CommonEventDetail.tsx     头部、执行、触发开关、会修改、引用关系                    ☐ 第 1 期
  events/useEventsData.ts          page 取数（link 优先，回退 API）                          ☐ 第 1 期
  map/MapPane.tsx 等               地图树、地图信息、事件表、事件详情抽屉                     ☐ 第 2 期
  tabs.ts / tab-icons.tsx          新增 common、map                                         ☐

lib/i18n/messages/events-types.ts + parts/events.ts   events.* 四语言                       ☐ 第 1 期
```

单文件目标 ≤600 行。`GameEditWorkbench.tsx` 已接近上限，新分类只在其中加一个分支，props 收敛为 `events?: EventsSlot`（数据、加载态、执行回调），具体 UI 全在 `events/` 下。

## 4. 数据模型

### 4.1 原始输入

```ts
type RawEventSources = {
  commonEvents: unknown[] // CommonEvents.json，下标即 id，[0] 为 null
  system: unknown // System.json：switches / variables 名称
  items / weapons / armors / actors / troops: unknown[]
  mapInfos: unknown[] // MapInfos.json
  maps: Record<number, unknown> // MapXXX.json；未扫描时为空，mapsScanned=false
}
```

`normalizeCommands` 只保留 `{ code, indent, parameters }`，非法项丢弃，不抛错。指令条数（`CommonEventInfo.commandCount`，`countCommands`）与「空事件」判定不计 `code === 0`（每段列表结尾的空指令与分支结束标记）。

### 4.2 输出 `CommonEventsData`

| 字段          | 说明                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `source`      | `disk`（服务读盘）/ `live`（游戏进程）                                                            |
| `events`      | 全部非 null 槽位（含空事件，由 UI 默认隐藏）；`name` 为译名，`rawName` 原名                       |
| `names`       | 按 id 下标的名称数组（开关、变量、物品、角色、地图、公共事件、敌群），已翻译                      |
| `texts`       | 对话 / 选项原文 → 译文，解释器渲染时查                                                            |
| `calledBy`    | `公共事件 id → EventRef[]`，来源为公共事件、敌群、地图事件页中的 117                              |
| `mapsScanned` | 是否提供了地图数据（未扫描时为 `false`）                                                          |
| `mapsFailed`  | 读取 / 解析失败的地图数；与 `!mapsScanned` 任一成立时 UI 在引用关系处标「可能不完整」             |
| `switchRefs`  | 开关 id → `EventRef[]`，提示显示数量、确认框列出事件，见 §6.2；第 2 期按同样方式补 `variableRefs` |

翻译：local 用 `loadGameTranslateLookup` + `translateWithLookup`（共享缓存 `openSharedCache`）；局内用 ChayaTrans 的 `tName`。只查不补译，不触发网络请求。

### 4.3 解释器 `ScriptLine`

```ts
type ScriptLine = {
  indent: number
  key: ScriptKey // i18n events.cmd.<key>
  tone: ScriptTone // text / flow / effect / risk / muted
  args?: Record<string, string | number>
  body?: string // 对话 / 脚本正文（有译文时为译文）
  source?: string // 原文，与 body 相同时省略（悬停显示）
  link?: { kind: 'common' | 'map'; id: number }
}
```

规则：

- 101 + 后续 401 合并为一行，说话人取 101 的名字参数（MZ `parameters[4]`，MV 无此参数则不显示）；102 / 402 / 403 / 404、111 / 411 / 412、112 / 413 用 indent 表达层级，组件按 indent 折叠。
- 121 / 122 / 123 显示名称与编号；范围操作（如 #3–#8）合并一行。
- 201 产生 `link.kind = 'map'`（地图页上线前组件只显示地图名，不渲染为链接）；117 产生 `link.kind = 'common'`。
- 355 + 655 合并为脚本块，356（MV）/ 357（MZ）原样显示参数。
- 未识别指令 → `key: 'other'`、`tone: 'muted'`，`args: { code, params }`（params 为 JSON，截断 120 字）。

### 4.4 副作用摘要

`summarizeEffects(list)` 单次遍历（不展开 117 调用的子事件，避免递归与环），输出各类集合。`isRiskyEffects` 为真的条件：战斗（301）、游戏结束（353）、回标题（354）、打开存档（352）、传送（201）。改队伍（129）只进摘要，不触发确认。风险项决定执行前是否确认。

## 5. 协议

```ts
// GameEditCmdOp 新增
| { op: 'commonEvent'; id: number }                         // 第 1 期 ✅
| { op: 'selfSwitch'; mapId: number; eventId: number; letter: 'A'|'B'|'C'|'D'; value: boolean } // 第 2 期
| { op: 'teleport'; mapId: number; x: number; y: number; direction?: 2|4|6|8; near?: boolean } // 第 2 期
| { op: 'mapEvent'; eventId: number }                        // 第 2 期，仅当前地图，Cheats.startMapEvent
| { op: 'undo' }                                             // 第 3 期

// 消息
{ type: 'edit.events.request' }                 // 控制台 → 游戏
{ type: 'edit.events'; data: CommonEventsData }  // 游戏 → 控制台
{ type: 'edit.map.request'; mapId }              // 第 2 期
{ type: 'edit.map'; data: MapDetailData }        // 第 2 期
```

- **分片传输（第 1 期必须）**：`edit.events` / `edit.map` 体积可达数 MB，而 link 走 WebRTC DataChannel，单条消息过大会发送失败（现有 `edit.catalog` 也未分片）。通用分片 `lib/runtime/link-chunks.ts`（4 KiB 一片、乱序丢弃、60 秒超时、总量上限，与 `translation-rpc` 同参数）：游戏端 `sendChunked` 发 `link.chunk`，网页端 `WebGameLink` 收齐后按原消息分发，业务代码照常监听 `edit.events`。`edit.map`（第 2 期）同样经它发送；`translation-rpc` 带请求关联与取消，暂不迁移。HTTP API 不受影响。
- `edit.ack` 增加 `error?: string`，插件抛出的 `Error.message` 原样回传，UI 用 toast 显示。
- `useGameEditLinkSync.sendCmd` 改为返回 `cmdId`，新增 `onAck(cmdId, cb)`；乐观更新类操作行为不变，事件执行类等待 ack 再提示成功。
- 触发开关切换复用已有 `{ op: 'sw', id, value }`，不新增 op。
- `edit.state` 增加 `onMap: boolean`（✅，随每秒状态推送），网页端据此置灰「执行」；ack error 作为兜底（状态同步有延迟）。第 2 期再加 `mapId`、`playerX`、`playerY`、`recentMaps`。

## 6. UI

### 6.1 路由与分类

- `TABS` 在 `actor` 后插入 `common`（公共事件）、`map`（地图，第 2 期）。路由 `/cheat/common/:id?`、`/cheat/map/:mapId?/:eventId?`，沿用 `[[...pane]]`。
- 局内 `scopeForTab` 中两者不需要 catalog；`tabNeedsCatalog` 返回 false，改为进入时调 `buildLiveCommonEventsData()`。结果缓存在 `live-events.ts` 模块级（整局游戏一份，局内浮层与 link 请求共用），刷新按钮传 `force` 重建。

### 6.2 公共事件页

- 宽屏：左列表 `w-[17rem]`（对齐 `ActorEditPane` 的 aside 模式），右详情；窄屏（内容区容器宽度 < 56rem，覆盖 816 宽游戏窗口）列表 → 详情，顶部返回。用容器查询而非视口断点，page 与 overlay 一致。
- 列表行：编号（`font-mono`）、译名、触发方式 `Badge`；自动 / 并行附开关状态。分组标题可折叠（`groups.ts`）。
- 筛选用 `SegmentedNav`（全部 / 手动 / 自动执行 / 并行），搜索复用 `GameEditSearch`；「显示空事件」「仅未被调用」放筛选区开关。
- 详情：
  - 执行按钮：`trigger === 0` 时显示；未连接或 `onMap === false` 时禁用并在 tooltip 说明原因。
  - 风险确认：`isRiskyEffects` 为真时用现有 `confirm()`，正文列副作用摘要。
  - 触发开关：`SwitchToggle`，切换前 confirm，旁边显示引用数，确认框列出引用事件（`switchRefs`：在构建 `calledBy` 的同一遍历中收集地图事件页条件、公共事件触发开关、111 条件、121 操作）。
  - 引用关系：common 条目跳转 `/cheat/common/:id`；map 条目第 2 期起跳 `/cheat/map/:mapId/:eventId`；troop 只展示。
  - 「未被调用」筛选只作用于 `trigger === 0`；`mapsFailed > 0` 或未扫描地图时在筛选旁提示结果可能偏多。
  - 离线（`source === 'disk'` 且未连接）时不显示触发开关状态与「运行中」，只显示开关编号与名称。
- 空态：数据为空用 `EmptyState`（无数据），筛选无结果用「无匹配」；游戏非 RPG Maker MV/MZ 数据时显示无数据，不报错。
- 局内执行成功后关闭面板（`onClose`），网页端保持页面并 toast。

### 6.3 地图页（第 2 期）

- 树：`MapInfos` 按 `parentId` / `order` 组装；事件数、跨图事件名搜索来自 map-index（随 `edit.events` 下发的轻量索引，不含指令）。当前地图来自 `edit.state` 新增字段 `mapId`、`playerX`、`playerY`。
- 事件表：`map-index` 推断类型；状态「出现中 / 未出现」在当前地图读 `$gameMap.events()`，非当前地图按页条件 + `$gameSwitches` / `$gameVariables` / `$gameSelfSwitches` 推算，并标「推算」。
- 单张地图详情按需请求（`edit.map.request` 或 `GET /api/game-edit/map?id=`），不进总索引。离线（走 API）时 `MapDetailData` 不含状态字段，事件表状态列与独立开关显示「—」。
- 确认规则（与需求 §2.4 一致）：入口 / 指定坐标传送、单个独立开关切换不弹确认；迷你地图点选传送、批量操作、执行含风险副作用的事件弹确认。
- 传送落点：入口来自 map-index 的 201 汇总；指定坐标在 UI 按 `width` / `height` 校验。`near: true` 时插件在 `Scene_Map` 就绪后按 `$gameMap.isPassable` 检查目标四邻，选第一个可走格再 `locate`，都不可走则留在原坐标。
- 立即触发 `mapEvent` 只对当前地图开放，插件侧再校验 `$gameMap.mapId()`。
- 最近去过：`plugins/src/cheat/session/map-history.ts` 挂 `Scene_Map.prototype.start` 记录 mapId（去重、最多 10 条），按游戏存 localStorage，经 `edit.state.recentMaps` 同步；不依赖 ChayaAgent。
- 迷你地图第 3 期（之前事件表占满右栏），图块 / 截图底图第 4 期。

## 7. 安全与撤销

- 游戏未连接：浏览可用，所有操作按钮禁用，tooltip「启动游戏后可用」。
- 插件侧所有事件类操作先检查 `SceneManager._scene instanceof Scene_Map`，不满足直接抛错，不排队。
- 第 3 期撤销：`plugins/src/cheat/session/undo-stack.ts` 保存最近 20 步，每步记录被改项的旧值（开关、变量、独立开关、玩家地图坐标）。执行公共事件时预先用 `summarizeEffects` 得到会改的开关 / 变量并记录旧值；其余副作用不记录，确认框写明。`{ op: 'undo' }` 弹栈还原，跨地图时先传送回原图。

## 8. 测试

- `__tests__/lib/game/events/build.spec.ts`：空槽位、无名事件、117 来自地图 / 敌群 / 公共事件的 calledBy、mapsScanned=false。
- `effects.spec.ts`：各风险指令识别；121 范围；不展开 117。
- `interpret.spec.ts`：101+401 合并、102/111 缩进、201/117 link、355+655 合并、未知指令、译文与原文。
- `services/game/game-edit-events` 用临时目录 fixture 读盘；`app/api/game-edit/events` 覆盖未绑定游戏返回 4xx。
- 组件：`CommonEventsPane` 空态 / 无匹配、筛选、执行按钮禁用条件、风险确认。
- 手测：两个 demo 都不带 `data/*.json`（`demo:game` 无数据，`demo:walk` 数据在 `data.js` 里），只能验证空态与「无数据」；执行、引用关系、ack 错误提示用真实 MV / MZ 游戏验证，并用数百张地图的游戏验证加载进度与耗时。

## 9. 分期与状态

| 期  | 内容                                                                                                                                                                | 状态                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | 事件索引、解释器、公共事件页、执行、触发开关切换、link 分片、i18n、测试                                                                                             | 数据层 / 协议完成，UI 待做 |
| 2   | 地图页、单图详情、传送（入口 / 指定坐标 / near）/ 独立开关 / 触发地图事件 op、最近去过、edge 授权读盘、公共事件内容搜索与「运行中」状态（`$gameMap._commonEvents`） | 未开始                     |
| 3   | 迷你地图、插件侧撤销栈、批量操作                                                                                                                                    | 未开始                     |
| 4   | 迷你地图图块 / 截图底图                                                                                                                                             | 未开始                     |

## 10. 风险

- **地图数量大**：local 当前每次请求读全部 `MapXXX.json`。第 1 期加按 mtime / 大小的内存缓存（`services/game/game-edit-events.ts` 模块级 Map，键为游戏根目录）；局内并发 8 读取，失败计入 `mapsFailed`，不阻塞。
- **加密 / 打包数据**：XHR 走引擎同路径，能被引擎加载的数据就能读；服务读盘遇到非 JSON 时该文件跳过并计入 `mapsFailed`。
- **link 消息体积**：`edit.events` 已分片。`edit.catalog` 仍未分片，超大数据库游戏可能受影响，后续可改用 `link-chunks`。
- **自动执行事件锁死**：打开触发开关可能让游戏陷入自动执行循环；确认框提示，且开关在面板中始终可关闭（面板不受游戏输入锁影响）。
- **`GameEditWorkbench.tsx` 行数**：新分支只透传 slot，必要时把 tab 分支表抽到 `workbench-body.tsx`。
