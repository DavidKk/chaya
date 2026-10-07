# 修改：敌群、立即遇敌与战斗中改敌人技术方案

> 状态：**已冻结**（2026-10-07）：功能已完成，本文作为现状记录，不再随需求扩写；后续改动另起文档或只做勘误。第 1–4 期已实现（含开战敌人数量）；兼容性待真实游戏抽查
> 日期：2026-10-07
> 需求：[`../edit-troops.md`](../edit-troops.md)
> 关联：[`edit-map-events.md`](./edit-map-events.md)（事件索引、命令通道、地图页）、[`chaya-ui-style-guide.md`](./chaya-ui-style-guide.md)

## 1. 决策

- **数据并入事件索引**：敌群列表、敌人名称、遇敌出处都在构建 `CommonEventsData` 的同一遍历里产出（`lib/game/events/`），不新开 `edit.troops` 消息或 API。敌群页与公共事件 / 地图共用 `useEventsData` / `useOverlayEvents` 的加载与缓存。
- **单图遇敌列表进 `MapDetailData`**：地图页“遇敌”区块只需当前打开的这张图，随 `edit.map` / `GET /api/game-edit/map` 一起下发。
- **所有操作走现有命令通道**：新增 `troop`、`enemyTransform`、`enemyAdd`、`enemyKill`、`enemyRevive`、`enemyHp`、`enemyMhp` 七个 op，经 `edit.cmd` → `remote-bridge` → 插件，`edit.ack` 回传错误；局内浮层直接调用同一函数。
- **开战与引擎“战斗处理”（301）一致**：`BattleManager.setup` → `setEventCallback(null)` → `$gamePlayer.makeEncounterCount()` → `SceneManager.push(Scene_Battle)`。不用 `goto`：地图不在场景栈里时，战斗结束 `SceneManager.pop()` 会因栈空调用 `exit()`。
- **变身沿用引擎“敌人变身”（336）**：`Game_Enemy.transform(enemyId)` + `$gameTroop.makeUniqueNames()`，精灵靠引擎每帧比对图片名自动换图。引擎 `transform` 只把 HP / MP 截到新上限，需求要求回满，所以之后再 `setHp(mhp)` / `setMp(mmp)`。
- **开战敌人数量在建精灵前调整**：`BattleManager.setup` 之后、`Scene_Battle` 创建前改 `$gameTroop._enemies`（复制 / 隐藏），精灵与战斗插件的附属 UI 都按调整后的成员正常创建，比战斗中追加兼容性好得多。
- **追加需要自建精灵并探测兼容性**：引擎只在战斗开始时为敌人建精灵。追加时建 `Sprite_Enemy` 挂到战场、放进 `_enemySprites` 与 `$gameTroop`，再调用一次 `spriteset.update()` 探测：部分插件按开战时的精灵数建了附属数组（如 `MOG_EnemyHP` 的 HP 条，每帧按 `_enemySprites` 下标访问），多一个精灵会每帧报错。探测失败先把精灵移出 `_enemySprites`（仍作为战场子节点绘制、更新）再探测；仍失败则整体回滚，不留下“隐形敌人”。
- **战斗状态随 `edit.state` 推送**：网页端需要场上敌人列表，`edit.state` 增 `battle`（仅战斗中有值），与 `onMap` 同频推送。
- **校验在插件侧**：前置条件只在游戏进程判断，同步抛错；网页端按 `edit.state` 预先置灰，其余条件靠 ack 错误兜底。
- **Agent 不变**：`chaya_edit_action` 与 `agent-edit.ts` 不新增动作。

## 2. 总体架构

```text
修改 › 敌群（/cheat/troop/:id?）                       修改 › 地图 › 遇敌区块
  events/TroopsPane                                      events/MapEncounters
    ├ CurrentBattle（战斗中）  slot.battle                 │  mapDetail.encounters
    │   └ EnemyPicker → { op: 'enemyTransform' | 'enemyAdd' }
    └ TroopDetail  data.troops / troopEncounters / troopRefs
        └ TroopBattleButton ─────────────┬───────────────┘
                                          │ { op: 'troop', id, canEscape, canLose }
                   ┌──────────────────────┴──────────────────────┐
              page：runCmd → edit.cmd → remote-bridge        overlay：applyOp
                   └──────────────────────┬──────────────────────┘
                                          ▼
  plugins/src/cheat/session/live-troop.ts    startTroopBattle → Cheats.startTroop（setup + push）
  plugins/src/cheat/session/live-battle.ts   transformEnemy / addEnemy / readBattleState
```

## 3. 模块落点

```text
lib/game/events/
  troops.ts        normalizeTroops / troopMemberSummary / encounterShares（纯函数）   新增 1
  build.ts         RawEventSources 增 enemies；产出 troops、troopEncounters、troopRefs；
                   buildMapDetail 产出 encounters、encounterStep                        改 1
  types.ts         TroopInfo / TroopMember / TroopEncounter；EventNames.enemies          改 1
  map-index.ts     MapDetailData 增 encounters、encounterStep                            改 1
lib/game/battle/
  types.ts         BattleState / BattleEnemyState                                       新增 3
  enemy-spot.ts    pickEnemySpot：按现有敌人位置与尺寸找不重叠的落点（纯函数）         新增 4

services/game/game-edit-events.ts         读 Enemies.json                               改 1
plugins/src/cheat/session/live-events.ts  传 $dataEnemies                               改 1
plugins/src/cheat/session/live-troop.ts   startTroopBattle：校验 + 调 Cheats            新增 1
plugins/src/cheat/session/live-battle.ts  readBattleState / transformEnemy / addEnemy   新增 3（addEnemy 4）
plugins/src/cheat/session/live-map.ts     导出 transferPending                          改 1
plugins/src/cheat/runtime/cheats.ts       startTroop 改 push、加 canEscape / canLose    改 1
plugins/src/cheat/console/console-api.ts  troop(id, canEscape?, canLose?) 走 startTroopBattle 改 1
plugins/src/cheat/session/remote-bridge.ts 三个 op；buildStateMsg 加 battle             改 1 / 3
plugins/src/cheat/ui/useOverlayEvents.ts  applyOp 三个 op；view 增 troopId；scene 增 battle 改 1 / 3

lib/runtime/game-link-protocol.ts         GameEditCmdOp 增三个 op；GameEditStateMsg.battle 改 1 / 3
lib/runtime/game-edit-sync.ts             三个 op 的 ack 字段与期望值；scene 透传 battle 改 1 / 3

components/game-edit/
  tabs.ts                    TABS 在 map 后加 troop；isEventsTab 含 troop；editTroopHref 改 1
  tab-icons.tsx              troop 图标                                                 改 1
  events/types.ts            EventsOp 含三个 op；EventsSlot 增 troopId / onSelectTroop / battle 改 1 / 3
  events/EventsBody.tsx      工作台 events 分支抽出（§6.6）                             新增 1
  events/TroopsPane.tsx      列表 + 详情（宽屏分栏 / 窄屏逐层）；顶部挂 CurrentBattle   新增 1
  events/TroopDetail.tsx     头部、开战、出现在、被调用、战斗事件                      新增 1
  events/TroopBattleButton.tsx 开战按钮 + 确认（读会话选项）；敌群页与遇敌区块共用    新增 1
  events/battle-options.ts   开战选项会话记忆（lib/view-state）                         新增 1
  events/MapEncounters.tsx   地图页“遇敌”区块                                          新增 1
  events/MapDetail.tsx       插入 MapEncounters                                         改 1
  events/CurrentBattle.tsx   场上敌人列表、变身、追加                                   新增 3
  events/EnemyPicker.tsx     敌人选择器（Popover + 搜索列表）                           新增 3
  ../GameEditRunSettings.tsx “战斗”卡片标题旁加“管理场上敌人”链接（onOpenTroops）       改 3
  GameEditWorkbench.tsx      events 分支改为渲染 EventsBody                             改 1
components/GameEditPage.tsx  解析 /cheat/troop/:id；填 troopId / onSelectTroop / battle 改 1 / 3

lib/i18n/messages/events-types.ts + parts/events.*.ts   events.troop.* / events.battle.* 四语言 改
```

行尾数字为所属分期（§9）。

## 4. 数据模型

### 4.1 原始输入

`RawEventSources` 增 `enemies: unknown[] | null`（`Enemies.json` / `$dataEnemies`），只取 `name`。

### 4.2 敌群

```ts
type TroopMember = { enemyId: number; name: string; hidden: boolean }

type TroopInfo = {
  id: number
  name: string // 译名，未翻译时原名
  rawName: string
  members: TroopMember[] // 只保留 enemyId > 0 且敌人存在的成员
  pages: EventCommand[][] // 战斗事件页指令（normalizeCommands）
  commandCount: number // 各页 countCommands 之和
}
```

- `CommonEventsData` 增：
  - `troops: TroopInfo[]`：全部非 null 槽位，空敌群（无有效成员）由 UI 默认隐藏。
  - `troopEncounters: Record<number, TroopEncounter[]>`：敌群 id → 出现在哪些地图的遇敌列表（第 2 期使用，第 1 期即产出）。
  - `troopRefs: Record<number, EventRef[]>`：敌群 id → “战斗处理”直接指定它的地图事件 / 公共事件 / 敌群页（301 且 `parameters[0] === 0`；变量指定、随机遇敌（1 / 2）不计）。
- `EventNames` 增 `enemies`：解释器的 301 行、成员摘要、战斗中敌人选择器共用（选择器按 id 与译名搜索）。
- 成员摘要 `troopMemberSummary(members)`：同名合并为“名称 ×N”，`hidden`（中途出现）的成员标注，摘要超过 3 种时截断加“等”。
- 战斗事件页指令的文本进 `texts`（`collectTexts`），解释器渲染时查译文。

```ts
type TroopEncounter = { mapId: number; weight: number; regionSet: number[] }
```

### 4.3 地图遇敌列表

`MapDetailData` 增：

```ts
encounters: Array<{ troopId: number; weight: number; regionSet: number[] }> // MapXXX.json encounterList，troopId ≤ 0 的项丢弃
encounterStep: number
```

出现概率 `encounterShares(encounters)`：RPG Maker 每次遇敌时，从“无区域限制 + 区域包含玩家所在区域”的项中按权重抽取。因此：

- 无区域限制的项：显示 `weight / Σ 无区域项 weight`（玩家不在任何限定区域时的概率）。
- 有区域限制的项：只显示权重与“仅区域 1、3”，不给百分比（取决于玩家所在区域）。
- 全部为区域项时都不显示百分比。

### 4.4 战斗状态

```ts
type BattleEnemyState = {
  index: number // $gameTroop.members() 下标
  enemyId: number
  name: string // Game_Enemy.name()，含 A / B 字母
  hp: number
  mhp: number
  alive: boolean
  appeared: boolean // false = 中途出现且尚未出现
}

type BattleState = { enemies: BattleEnemyState[]; ended: boolean } // ended：BattleManager 已在结算（battleEnd / aborting）
```

- `GameEditStateMsg` 增 `battle?: BattleState`，仅 `SceneManager._scene instanceof Scene_Battle` 时有值。
- 局内 `readScene()` 同样读 `readBattleState()`，`sameScene` 比较时纳入（`index:enemyId:hp:alive:appeared` 拼串）。
- `EventsSlot` 增 `battle: BattleState | null`。

## 5. 协议与插件

### 5.1 命令

```ts
// GameEditCmdOp 新增
| { op: 'troop'; id: number; canEscape: boolean; canLose: boolean; count?: number } // 第 1 期；count 见 §5.7
| { op: 'enemyTransform'; index: number; fromEnemyId: number; enemyId: number } // 第 3 期
| { op: 'enemyAdd'; enemyId: number } // 第 4 期
| { op: 'enemyKill'; index: number; fromEnemyId: number }
| { op: 'enemyRevive'; index: number; fromEnemyId: number }
| { op: 'enemyHp'; index: number; fromEnemyId: number; hp: number }
| { op: 'enemyMhp'; index: number; fromEnemyId: number; mhp: number }
```

- `fieldsForEditCmd`：`action:troop:<id>`、`action:enemyTransform:<index>`、`action:enemyAdd`、`action:enemyKill:<index>`、`action:enemyRevive:<index>`、`action:enemyHp:<index>`、`action:enemyMhp:<index>`；`expectForEditCmd` 均为 `true`（与 `commonEvent` 相同，只等 ack）。
- `remote-bridge.applyEditCmd` 分别调 `startTroopBattle` / `transformEnemy` / `addEnemy`，同步抛错由现有逻辑转成 `ack.error`。
- `enemyHp`：`writeEnemyHp` 取整并夹到 0..mhp 后 `setHp`，为 0 时同 `enemyKill`；`enemyKill` 即 `writeEnemyHp(hp: 0)`。
- `enemyMhp`：`writeEnemyMhp` 用 `addParam(0, δ)` 改加算值，δ 按当前 `mhp / (paramBase + paramPlus)` 折算，保留倍率与 buff，`refresh` 后不回弹；当前 HP 由引擎截断。
- `enemyRevive`：仅限已出现且倒下的敌人；`setHp(mhp)`，引擎 `refresh` 移除死亡状态，`Sprite_Enemy.setupEffect` 见“未出现且存活”自动播 appear；目标窗口激活时 `refresh()`。UI 在倒下行把“杀死”位换成“复活”。
- `enemyKill`：`setHp(0)`（`refresh` 加死亡状态）后调 `performCollapse()`；不主动结束战斗，胜利由 `BattleManager` 照常判定（输入阶段要等回合开始）。
- `enemyTransform` / `enemyKill` 带 `fromEnemyId`：状态推送有延迟，插件发现该下标的敌人已不是它时拒绝，避免改错对象。

### 5.2 `startTroopBattle`（`live-troop.ts`）

按顺序校验，失败抛 `Error`（错误文案与现有插件一致，用中文）：

| 条件                                               | 错误                           |
| -------------------------------------------------- | ------------------------------ |
| `isOnMapScene()`                                   | 请回到地图场景再开战           |
| `!SceneManager._nextScene`（场景切换中）           | 场景切换中，请稍后再试         |
| `!transferPending()`                               | 传送中，请稍后再试             |
| `assertIdle()`（地图解释器空闲）                   | 有事件正在执行，请等它结束再试 |
| `!$gameMessage?.isBusy?.()`                        | 对话进行中，请稍后再试         |
| `$dataTroops[id]` 存在且至少一个成员对应存在的敌人 | 敌群 N 不存在或没有敌人        |

通过后调 `Cheats.startTroop(id, canEscape, canLose)`；返回 false 时抛“游戏未就绪”。

### 5.3 `Cheats.startTroop`

```ts
startTroop(troopId: number, canEscape = true, canLose = false) {
  // 校验 tid、$dataTroops、BattleManager、SceneManager.push、Scene_Battle
  BattleManager.setup(tid, canEscape, canLose)
  BattleManager.setEventCallback?.(null)
  $gamePlayer?.makeEncounterCount?.()
  SceneManager.push(Scene_Battle)
  return true
}
```

- `push` 触发 `Scene_Map.stop()` → `launchBattle()`：保存 BGM、播放开战音效与遇敌转场；战斗结束 `BattleManager` 调 `SceneManager.pop()` 回到地图，玩家位置不变。
- 不调用 `BattleManager.onEncounter()`：手动开战不产生先发制人 / 被偷袭，与 301 一致。
- 战败且 `canLose === false` 时由引擎进入 `Scene_Gameover`，不额外处理。
- `agent/history.ts` 已挂 `BattleManager.setup`，开战与结果自动进入历史，无需改动。
- 控制台 `ChayaEdit.troop(id, canEscape?, canLose?)` 改调 `startTroopBattle`，错误打日志并返回 false。

### 5.4 局内浮层的暂停

浮层打开时 `SceneManager.stop()`，游戏既不更新也不重绘。

- **开战**：`push` 只设置 `_nextScene` 并启动转场，真正切换要等游戏循环恢复。流程：`applyOp` 成功 → `slot.afterRun()`（`onClose`）→ `resumeGame()` → 转场 → 战斗。与执行公共事件后收起面板的现有行为一致，不需要 `runGameUntil`。网页端发起时若局内浮层恰好开着，战斗会在浮层关闭后开始；ack 已成功，不视为错误。
- **变身 / 追加**：数据立即生效，画面在关闭浮层后刷新；面板不自动收起，`applyOp` 后立即 `readScene()` 刷新“当前战斗”列表。

### 5.5 战斗中操作（`live-battle.ts`）

共同前置条件（`assertBattleEditable`）：

| 条件                                                                               | 错误                   |
| ---------------------------------------------------------------------------------- | ---------------------- |
| `SceneManager._scene instanceof Scene_Battle`                                      | 只能在战斗中使用       |
| `!SceneManager._nextScene`                                                         | 场景切换中，请稍后再试 |
| `BattleManager._phase` 不是 `battleEnd` / `aborting`，且 `!$gameTroop.isAllDead()` | 战斗已结束             |
| 目标 `$dataEnemies[enemyId]` 存在                                                  | 敌人 N 不存在          |

**`transformEnemy({ index, fromEnemyId, enemyId })`**（第 3 期）

1. `const enemy = $gameTroop.members()[index]`；不存在或 `enemy.enemyId() !== fromEnemyId` → “场上敌人已变化，请重试”。
2. `!enemy.isAlive()` → “该敌人已倒下”；`enemy.isHidden()` → “该敌人尚未出现”。
3. `enemy.transform(enemyId)`；`setHp(mhp)`、`setMp(mmp)`；`$gameTroop.makeUniqueNames()`。引擎 `transform` 只调 `refresh()` 把 HP / MP 截到新上限（MV / MZ 一致），回满是本功能额外做的。

**`addEnemy({ enemyId })`**（第 4 期）

1. 存活敌人数 ≥ 8 → “场上敌人已达上限”。
2. 取战场：`scene._spriteset`、`spriteset._battleField`、`spriteset._enemySprites`、`Sprite_Enemy`、`Game_Enemy` 任一缺失 → “该游戏的战斗画面不支持追加敌人”。
3. 落点：收集场上敌人的 `screenX()` / `screenY()` 与对应精灵 `bitmap` 宽高（未加载时按 120×120 估），交给 `pickEnemySpot`（§5.6）。新敌人尺寸：场上已有同 `battlerName` 的精灵时用它的尺寸，否则按 120×120；图片加载后实际尺寸不同也不再挪位置。
4. 建对象：`const enemy = new Game_Enemy(enemyId, x, y)`；`enemy.onBattleStart?.(false)`（MV 初始化 TP，MZ 还初始化 TPB 计时，参数为“非先发制人”）。
5. 建精灵并挂载：`const sprite = new Sprite_Enemy(enemy)`；`battleField.addChild(sprite)`；`enemySprites.push(sprite)`。
6. 入队：`$gameTroop._enemies.push(enemy)`；`$gameTroop.makeUniqueNames()`。
7. 第 4–6 步包在 `try` 中，任一步抛错：移除已挂的精灵、移除已入队的敌人、恢复 `_namesCount`，再抛“该游戏的战斗画面不支持追加敌人”。
8. 探测：`spriteset.update()` 抛错 → 精灵移出 `_enemySprites` 再探测；仍抛错 → 按第 7 步回滚并报同一错误。
9. 若敌人选择窗口正在显示（`scene._enemyWindow?.active`），调 `refresh()`；图片加载完后按真实尺寸重新选位（§5.6）。

不需要额外处理的部分（引擎按 `$gameTroop.members()` 动态计算）：目标选择、胜负判定、经验 / 金钱 / 掉落结算、下一回合行动顺序（`BattleManager.makeActionOrders` 每回合重建）。

### 5.6 `pickEnemySpot`（`lib/game/battle/enemy-spot.ts`）

```ts
pickEnemySpot(input: {
  existing: Array<{ x: number; y: number; width: number; height: number }> // x 为底边中点，y 为底边
  size: { width: number; height: number }
  bounds: { width: number; height: number } // Graphics.boxWidth / boxHeight
}): { x: number; y: number }
```

- 坐标系直接用现有敌人的 `screenX/Y`，不关心 MV / MZ 或战斗插件如何换算，只要新敌人与现有敌人在同一坐标系即可。
- 候选：以现有敌人底边 y 的中位数为第一行，x 从中心向两侧按 24px 步进，取第一个与所有现有矩形不相交（留 8px 间距）且不出界的位置；第一行放不下时，依次尝试上移 / 下移一个敌人高度的行。
- 全部放不下：返回与最近敌人中心距离最大的候选（允许重叠），对应需求 §8.3“放不下时仍加入”。
- 候选行间距为“新敌人与现有敌人高度中位数的较大者 + 8px”，相邻行不会因间距判定为重叠。
- `existing` 只传存活且已出现的敌人（已倒下的精灵会淡出，不必避开）。为空时，行 y 取全部成员（含已倒下）底边 y 的中位数；成员也为空时取 `bounds` 宽度中点、高度 60% 处。
- 选位时新敌人图片多半未加载，按 120×120 估；`settleSpots` 每 100ms 轮询（最长 30 秒），战斗场景里相关精灵图片都就绪后，用真实尺寸对新增的敌人重新选位（改 `_screenX/Y` 并 `setHome`）。

### 5.7 开战敌人数量（`resizeTroop`）

- 选项“敌人数量”：原样（默认）或 1–8，随开战选项会话记忆，`troop` op 带 `count`。
- `startTroopBattle` 在 `Cheats.startTroop`（setup + push）成功后调 `resizeTroop(count)`；`push` 只设置 `_nextScene`，战斗场景尚未创建，精灵会按调整后的成员建立。
- 只看“可见成员”（非中途出现）：数量少于可见成员时，多余的从后往前 `hide()`（战斗事件仍可让其出现）；多于时按可见成员顺序循环复制 `new Game_Enemy(id, x, y)`，位置由 `pickEnemySpots` 选，再 `makeUniqueNames()`，开战后 `settleSpots` 按真实尺寸调整。
- 战斗事件的“敌人 N HP”条件按下标判断，隐藏而不删除，下标保持不变。

## 6. UI

### 6.1 路由与分类

- `TABS` 在 `map` 后加 `{ id: 'troop', labelKey: 'events.tabTroop' }`；`isEventsTab` 改为 `tab is 'common' | 'map' | 'troop'`，敌群页因此复用事件数据加载、搜索框与刷新。
- 网页：`/cheat/troop`、`/cheat/troop/:id`（`editTroopHref`），`GameEditPage` 用 `parseActorIdSegment(params.pane?.[0])` 解析。
- 局内：`EventsView` 增 `troopId`，同样存 `window.__chayaEventsView` 与 `sessionStorage`。
- `EventsSlot` 增 `troopId: number | null`、`onSelectTroop(id | null)`；地图页“详情”与敌群页“出现在”互跳用 `onSelectTroop` / `onSelectMap`。
- 工作台搜索框计数：`tab === 'troop'` 时用 `data.troops.length`。

### 6.2 敌群页（`TroopsPane` / `TroopDetail`）

- 布局照搬 `CommonEventsPane`：宽屏左列表 `w-[17rem]` + 右详情；容器宽度 < 56rem 时列表 → 详情，顶部返回。`slot.battle` 有值时，列表与详情上方整宽显示 `CurrentBattle`（§6.5）。
- 列表行：译名（无名回退 `#id`）+ 成员摘要（次要色、单行省略）；不单列 ID，搜索可按 ID。
- 搜索：编号、敌群译名 / 原名、成员敌人译名 / 原名。筛选区开关“显示空敌群”。第 2 期加“只看可遇到”（默认开启；`troopEncounters` 或 `troopRefs` 非空；`!mapsScanned || mapsFailed > 0` 时旁边提示可能偏少）。
- 详情第 1 期：标题、成员列表（`hidden` 标“中途出现”）、战斗事件页数、开战选项开关 + `TroopBattleButton`。第 2 期：“出现在”（地图名 + 权重 + 区域，可跳地图页）、“被调用”（复用 `refLabel`，可跳转）、战斗事件（`SegmentedNav` 按页 + `EventScript` 只读，不传逐行执行回调）。
- 公共事件详情“引用关系”的 troop 条目第 2 期改为可点，调 `onSelectTroop`。
- 空态：无数据 `EmptyState`；筛选无结果“无匹配”。

### 6.3 开战控件（`TroopBattleButton`）

- 只是按钮：主文案“立即开战”，地图遇敌区块传 `label` 为“立即遇敌”。开战选项不在按钮里编辑。
- 选项开关“可以逃跑”“战败后继续”只放在 `TroopDetail` 头部，读写 `battle-options.ts`：`readViewState('troopBattle')` / `writeViewState`，默认 `{ canEscape: true, canLose: false }`，网页与局内各自一份会话记忆。按钮发起时读同一份选项。
- 禁用：`!slot.canAct` → tooltip “启动游戏后可用”；`!slot.onMap` → “请回到地图场景”。
- 点击 → `useConfirm`（`description` 为只读内容，`useConfirm` 只返回确定 / 取消）：标题含敌群名，正文列成员摘要与当前选项；`canLose === false` 时附警示“战败将进入游戏结束画面”，`confirmVariant: 'warn'`。
- 确认 → `await slot.onAct(op)` → 成功 toast，`slot.afterRun?.()`；失败 toast 游戏返回的错误。

### 6.4 地图页“遇敌”区块（`MapEncounters`）

- 位置：`MapDetail` 中迷你地图之后、事件表之前；窄屏在事件表上方。`encounters` 为空时不渲染。
- 标题行：“遇敌” + 遇敌步数（`encounterStep`）。
- 每行：敌群名（`data.troops` 查表，缺失时 `#id`）、成员摘要、概率或“仅区域 …”（§4.3）、操作。
- 操作：`TroopBattleButton`（`label` 为“立即遇敌”）；非当前地图（`player?.mapId !== mapDetail.mapId`）禁用并提示“请先传送到这张地图”。“详情”跳 `/cheat/troop/:id`。
- 离线（API 读盘）同样有 `encounters`，操作按 `canAct` 置灰。

### 6.5 当前战斗区块（`CurrentBattle` / `EnemyPicker`，第 3、4 期）

> 已迁到战斗页：`CurrentBattle` 拆为 `components/game-edit/battle/BattleEnemies.tsx`，见 [edit-battle.md](./edit-battle.md)。下文保留为敌方规则说明。

- 只在 `slot.battle` 有值时渲染。每行：名称、HP `hp/mhp`、状态 `Badge`（已倒下 / 未出现），右侧“变成…”。
- 每行三个 `mini` 图标按钮（tooltip 说明）：杀死 → `enemyKill`；复制 → `{ op: 'enemyAdd', enemyId: 本行 enemyId }`；替换 → 下述 `EnemyPicker`。名字 / HP / 状态同字号，只用颜色区分。区块用 `DataTable`（敌人 / HP / 状态 / 操作）；HP 列为 `HpInput`：一个 `NumberInput`（当前 HP）的 `endAction` 里嵌无边框 `NumberInput`（上限），同框；仅 blur / 回车且值变化时发 `enemyHp` / `enemyMhp`（方向键步进不逐次发送），Esc 取消。
- “替换”打开 `EnemyPicker`：`Modal`（局内传浮层的 ShadowRoot 作 portal 容器）内一个搜索框 + 列表，按 id 与译名匹配，最多渲染前 200 条匹配项（敌人数据库通常不足 1000 条，不做虚拟滚动）。顶部说明“变身后 HP / MP 回满”。选中即发 `{ op: 'enemyTransform', index, fromEnemyId, enemyId }`。
- 区块标题右侧“追加敌人”（第 4 期）：同一个 `EnemyPicker`，选中发 `{ op: 'enemyAdd', enemyId }`；存活敌人 ≥ 8 时禁用并提示上限。
- 已倒下 / 未出现的行、`battle.ended` 时全部操作禁用，tooltip 说明原因。
- 不弹确认；成功 toast（“已变成 B” / “已追加 B”），失败 toast 游戏返回的错误。不调用 `afterRun`。
- 选择器数据：`data.names.enemies`（id → 译名），默认隐藏无名敌人，开关可显示。

### 6.6 “运行”页链接与工作台行数

- `GameEditRunSettings` 的“战斗”`ActionCard` 增可选 `extra` 插槽，标题右侧放“管理场上敌人”链接；`GameEditRunSettings` 增 `onOpenTroops` prop，由工作台传 `() => setTab('troop')`（网页与局内都已由 `setTab` 处理路由 / 分类切换）。
- `GameEditWorkbench.tsx` 当前 668 行，超出 600 行目标。本次把 `eventsTab` 分支（`EmptyState` / 懒加载 pane 的选择）抽到 `events/EventsBody.tsx`，工作台只渲染 `<EventsBody slot={events} tab={tab} … />`；新增 troop 后工作台行数应下降。

## 7. 安全

- 所有开战路径（网页、局内、控制台）都经 `startTroopBattle`，前置条件一致；不排队、不重试。
- 网页端只能预判 `onMap` / `battle`，解释器忙、对话中、传送中依赖 ack 错误；状态推送有 1 秒延迟，以插件校验为准。变身另用 `fromEnemyId` 防止改错对象。
- 每次开战都确认，不提供“不再提示”；变身 / 追加只影响当前战斗，不确认。
- 不修改 `$dataTroops`、`$dataEnemies`、`$dataMap.encounterList`、遇敌开关；`makeEncounterCount` 只重置步数，与 301 相同。
- 追加失败必须回滚到操作前的 `$gameTroop` 与精灵列表，测试覆盖（§8）。

## 8. 测试

- `__tests__/lib/game/events/troops.spec.ts`：`normalizeTroops` 丢弃无效成员与 null 槽位、`hidden`；成员摘要合并与截断；`encounterShares` 三种情况（全无区域、混合、全区域）。
- `build.spec.ts` 补：`troops` 产出与译名、`troopRefs` 只计 301 直接指定、`troopEncounters` 来自地图 `encounterList`、`enemies` 缺失时成员名为空串。
- `map-index` / `buildMapDetail`：`encounters`、`encounterStep`，非法项丢弃。
- `__tests__/lib/game/battle/enemy-spot.spec.ts`：第一行有空位、第一行满后换行、全满时取最远候选、无现有敌人、不出界。
- `__tests__/plugins/cheat/session/live-troop.spec.ts`：各前置条件的错误；通过时调用 `setup(id, canEscape, canLose)`、`makeEncounterCount`、`push(Scene_Battle)`，不调用 `goto`。
- `__tests__/plugins/cheat/session/live-battle.spec.ts`：`readBattleState` 字段；变身的下标失配 / 已倒下 / 未出现 / 战斗已结束错误，成功时调用 `transform` 与 `makeUniqueNames`；追加的上限、战场缺失、`Sprite_Enemy` 构造抛错与 `addChild` 抛错时回滚（`_enemies` 与 `_enemySprites` 长度不变）、成功时调用 `onBattleStart` 与刷新敌人窗口。
- `__tests__/lib/runtime/game-edit-sync` 相关用例补三个 op 的 fields / expect。
- 组件：`troops-pane.spec.tsx`（列表、搜索敌人名、空敌群开关、窄屏逐层、战斗中显示当前战斗区块）；开战按钮用例并入 `troops-pane.spec.tsx`（禁用条件、确认框内容与战败警示、onAct 参数、失败 toast）；`current-battle.spec.tsx`（行状态、禁用条件、选择器搜索、op 参数含 `fromEnemyId`、上限禁用追加）；`map-pane.spec.tsx` 补遇敌区块（空列表不渲染、概率显示、非当前地图禁用）。
- 手测：`fixtures/game-walk` 补最小 `$dataEnemies` / `$dataTroops` 与一张图的 `encounterList`，验证列表、遇敌区块与开战调用。场景栈、战斗结束回地图、变身换图、追加精灵与结算必须用真实游戏验证：MV、MZ 原生战斗各一款，外加至少一款横版或 ATB 战斗插件的游戏（追加不兼容时确认回滚与提示）。

## 9. 分期与状态

| 期  | 内容                                                                                                                                                                                         | 状态   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `startTroop` 改 push + `startTroopBattle` 校验；`troop` op；数据模型（含 `troopEncounters` / `troopRefs`）；敌群页列表 / 搜索 / 详情头部 / 开战；地图遇敌区块；`EventsBody` 拆分；i18n；测试 | 已完成 |
| 2   | 敌群详情“出现在”“被调用”、战斗事件解释器、“只看可遇到”；公共事件页 troop 引用可跳转                                                                                                          | 已完成 |
| 3   | `edit.state.battle` 与局内 scene；`enemyTransform` op；`CurrentBattle` / `EnemyPicker`；“运行”页链接；测试                                                                                   | 已完成 |
| 4   | `enemyAdd` op、`pickEnemySpot`、精灵挂载、探测与回滚；开战敌人数量；测试（兼容性抽查待真实游戏）                                                                                             | 已完成 |

## 10. 风险

- **插件改写场景流程**：部分插件替换 `Scene_Map.launchBattle` 或 `BattleManager.setup`（如 ATB / 横版战斗系统）。只调用引擎公开方法、不绕过它们，兼容性与原生 301 一致；仍需真实游戏抽查。
- **追加敌人的兼容性**：依赖 `Spriteset_Battle` 的内部字段 `_battleField` / `_enemySprites`，战斗插件可能改名、改结构，或另有一套精灵 / 行动队列（如 ATB 的计时条、YEP 的敌人 HP 条）。缺字段时直接拒绝并提示，能建精灵但插件额外 UI 不显示的情况无法全面检测，在需求中已标注风险，变身不受影响。
- **变身与战斗事件**：敌群战斗事件的条件按“敌人 N 的 HP”判断时，变身回满 HP 可能让事件重新满足或不再满足，与游戏自身使用 336 的效果一致，不额外处理。
- **敌群战斗事件依赖剧情状态**：手动开战时战斗事件照常执行，可能改开关 / 变量或调公共事件。确认框不展开副作用摘要（第 2 期可在详情里展示），由“每次确认”兜底。
- **索引体积**：`troops` 带战斗事件指令，通常远小于地图事件；`edit.events` 已分片，不做额外处理。
- **状态推送体积**：`battle.enemies` 最多十余项，随 `edit.state` 每秒推送，可忽略。
