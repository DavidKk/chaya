# 修改：战斗页技术方案

> 状态：**已冻结**（2026-10-07）：功能已完成，本文作为现状记录，不再随需求扩写；后续改动另起文档或只做勘误。一、二期已实现；待真实游戏验证项见 §9
> 日期：2026-10-07
> 需求：[`../edit-battle.md`](../edit-battle.md)
> 关联：[`edit-troops.md`](./edit-troops.md)（`live-battle.ts`、敌方 op）、[`chaya-ui-style-guide.md`](./chaya-ui-style-guide.md)

## 1. 决策

- **新二级分类 `battle`，挂在事件通道上**：战斗状态 `battle` 已随事件槽（`EventsSlot`）推送，敌方选择器也要 `data.names.enemies`，所以战斗页与事件类分类共用 `useEventsData` / 局内 `useOverlayEvents`。`usesEventsSlot(tab)`（`isEventsTab(tab) || tab === 'battle'`）统一决定是否加载事件数据与轮询场景。
- **敌方原样迁移**：`CurrentBattle` 拆成 `BattleEnemies`（表格）+ 共用控件 `controls.tsx`，`EnemyPicker` 不动；op 与 `live-battle.ts` 不变。
- **我方走事件通道的新 op，不复用 `actor` op**：局内的 `actor` op 走另一条会话路径，改完不会刷新场景快照、也不会重绘战斗状态窗。新增 `actorVital` / `actorRevive` / `actorRecover`，按角色编号定位，队员换位也不会改错人。
- **倒下 / 复活走引擎 `refresh`**：`setHp(0)` 时 `Game_Battler.refresh` 加死亡状态并播放倒下；复活先 `removeState(deathStateId())`（会调用 `revive()`）再 `setHp(mhp)`。
- **上限按倍率写**：`battle-param.ts` 的 `writeMaxParam` 用 `目标 / (param / (base + plus))` 算出 `addParam` 增量，保留装备 / 状态倍率与 buff，且不会被 `refresh` 还原。敌我共用。
- **改完重绘战斗状态窗**：每个我方 op 成功后调用 `BattleManager.refreshStatus?.()`。
- **全体动作复用运行动作**：`battle:victory / escape / defeat / abort / enemyHp1 / enemyHpMax / partyHeal / partyHp1 / partyHp0` 仍走 `applyRun`，只是按钮在战斗页。
- **Agent 不变**：不新增 `chaya_edit_action` 动作。

## 2. 总体架构

```text
修改 › 战斗（/cheat/battle）  BattlePane
  ├ 无 slot → 需连接；无 slot.battle → 空状态（去敌群开战）
  ├ 战斗流程          运行动作 battle:victory | escape | defeat | abort
  ├ BattleEnemies     enemyHp / enemyMhp / enemyKill / enemyRevive / enemyRecover / enemyTransform / enemyAdd
  │   └ EnemyPicker
  └ BattleParty       actorVital{hp,mp,mhp,mmp,tp} / actorRevive / actorRecover；全体 battle:party*
                          │
         page：slot.onAct → edit.cmd → remote-bridge      overlay：useOverlayEvents.applyOp
                          ▼
  plugins/src/cheat/session/
    live-battle.ts   readBattleState（含 party）/ 敌方函数 / assertBattleEditable
    live-party.ts    readParty / writeActorVital / reviveActor / recoverActor
    battle-param.ts  writeMaxParam
```

## 3. 模块落点

| 路径                                                      | 内容                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `components/game-edit/tabs.ts`                            | `battle` 分类（`run` 后，第二位）、`usesEventsSlot`                     |
| `components/game-edit/battle/BattlePane.tsx`              | 页面壳：需连接 / 空状态 / 战斗流程 + 敌方 + 我方                        |
| `components/game-edit/battle/BattleEnemies.tsx`           | 敌方表（行操作 + 标题栏全体动作 + 追加）                                |
| `components/game-edit/battle/BattleParty.tsx`             | 我方表                                                                  |
| `components/game-edit/battle/controls.tsx`                | `SectionHead`、`IconAction`、`useBattleRun`、`VitalInput`、`PlainInput` |
| `components/game-edit/GameEditTabNav.tsx`                 | `dots`：战斗中给 `battle` 图标加小圆点                                  |
| `lib/game/battle/types.ts`                                | `BattleActorState`、`ActorVitalKey`、`BattleState.party`                |
| `plugins/src/cheat/session/live-party.ts`                 | 我方读写                                                                |
| `plugins/src/cheat/session/battle-param.ts`               | `writeMaxParam`                                                         |
| `lib/runtime/game-link-protocol.ts` / `game-edit-sync.ts` | 新 op 与 fields                                                         |
| `components/GameEditRunSettings.tsx`                      | “战斗”卡片只留说明 + “打开战斗页”（`onOpenBattle`）                     |
| `components/game-edit/events/TroopsPane.tsx`              | 移除当前战斗区块（`CurrentBattle.tsx` 已删除）                          |

## 4. 数据模型

```ts
type BattleActorState = {
  actorId: number
  name: string
  hp: number
  mhp: number
  mp: number
  mmp: number
  tp: number
  maxTp: number // Game_BattlerBase.maxTp()，通常 100
  alive: boolean
}

type BattleState = {
  enemies: BattleEnemyState[]
  party: BattleActorState[] // $gameParty.battleMembers()，顺序同战斗画面
  ended: boolean
}

type ActorVitalKey = 'hp' | 'mp' | 'mhp' | 'mmp' | 'tp'
```

- `battleSignature` 纳入敌方 `mhp` 与我方全部字段，局内 `sameScene` 才会在数值变化时刷新。
- 锁死：会话里的角色锁（`lockKeyForActorVital`），`BattleParty` 直接读，不进 `BattleState`。
- 无敌：读会话 `god`。

## 5. 协议与插件

### 5.1 新 op

```ts
| { op: 'actorVital'; actorId: number; key: ActorVitalKey; value: number }
| { op: 'actorRevive'; actorId: number }
| { op: 'actorRecover'; actorId: number }
| { op: 'actorJoin'; actorId: number }
```

- `fieldsForEditCmd`：`action:actorVital:<id>:<key>`、`action:actorRevive:<id>`、`action:actorRecover:<id>`；`expectForEditCmd` 为 `true`（只等 ack）。
- 倒下 = `actorVital { key: 'hp', value: 0 }`。

### 5.2 插件函数（`live-party.ts`）

前置统一为 `assertBattleEditable()`（战斗中、未在切场景、未结束）+ 角色在 `battleMembers()` 内（否则“该角色不在战斗中”）。

- `writeActorVital`：倒下的角色拒绝（“该角色已倒下”）；`hp` / `mp` 截到 0..上限，`tp` 截到 0..`maxTp()`；`mhp` / `mmp` 走 `writeMaxParam`（下限分别 1 / 0）；HP 归零调用 `performCollapse`。
- `reviveActor`：已存活抛“该角色未倒下”；解除死亡状态 → `setHp(mhp)`。
- `recoverActor`：倒下的先解除死亡状态，再回满 HP / MP。
- `joinActor`：`$gameParty.addActor`（与“更改队伍成员”指令相同）；拒绝不存在的角色、已在队伍（含候补）的角色、出战人数已满。`BattleState` 带 `partyIds`（含候补）与 `partyMax`，选择器据此排除并禁用。
- 以上都在最后调用 `refreshStatus`。
- **指令输入中判胜负**：引擎只在 `start / turn / turnEnd` 阶段 `checkBattleEnd`，输入阶段杀光一方会一直停在指令菜单。`settleBattleEnd()`（`live-battle.ts`）在 `_phase === 'input'` 且无敌群事件时，按全灭方调用 `processVictory` / `processDefeat`，并收起正在选目标的子窗口；`writeEnemyHp` 归零、我方 HP 归零、运行动作 `battle:partyHp0` 之后调用。
- **结算胜负**（运行动作 `battle:settle`，战斗流程第五个按钮，可设快捷键）：`settleBattleEnd({ force: true })`，任何未收尾阶段都判一次，不等敌群事件；不在战斗中或双方都有存活者时什么都不做。`BattleState.settling`（`battleEnd` / `aborting`）只用来禁用战斗流程按钮；`ended`（含敌方全灭）仍禁用逐个修改。卡住（`ended && !settling`）时该按钮高亮并提示。

### 5.3 局内轮询

`useOverlayEvents` 在 `usesEventsSlot(tab)` 或面板打开时每秒读场景（`polling = active || open`），这样在别的分类也能及时点亮战斗小圆点；`onAct` 对 `enemy*` / `actor*` op 成功后立即刷新场景。

## 6. UI

- 路由：`/cheat/battle`，无二级段（多余段重定向回战斗页）。局内 `setTab('battle')`。
- 导航小圆点：`GameEditTabNav` 只有图标，圆点画在图标按钮右上角，`aria-label` 追加“· 战斗中”。
- 敌方、我方各一张卡片（`cardClass`，内容区 `p-3 gap-3`，靠左、`max-w-4xl` 同宽），卡片头为标题 + 右侧全体动作。
- 表格：敌我都用 `DataTable`，列宽常量共用；名字 / 数值 / 状态同字号，只用颜色区分；操作列 `align: 'right'`。
- `VitalInput`：`NumberInput`（当前）+ `endAction` 内无边框 `NumberInput`（上限）；失焦 / 回车且有变化才提交，Esc 取消。TP 用单个 `PlainInput`。当前值（HP / MP / TP）用 `NumberSliderInput`，聚焦出拖拽条，松手（`onSlideEnd`）才提交；上限部分标 `data-slider-ignore`，不弹滑块。
- 锁死：输入框 `disabled` + tooltip“已在角色页锁死”；HP 锁死或开着无敌时“倒下”禁用。名字列 `TextAction` 跳角色页（先 `setTab('actor')` 再 `setActorId`）。
- 运行页：“战斗”卡片只留说明 + “打开战斗页”。
- 战斗流程：四个图标按钮（胜利 / 逃跑 / 失败 / 中止，tooltip 为完整名称）经 `headSlot` portal 到面板标题栏右侧；无标题栏时退回内容顶部一行。

## 7. 测试

- `live-battle.spec`：`readBattleState` 含 `party`；敌方 kill / revive / HP / 上限。
- `live-party.spec`：读取、截断、上限倍率、倒下、复活 / 回满、前置拒绝。
- `game-edit-sync.spec`：敌方与我方 op 的 fields。
- `battle-pane.spec.tsx`：空状态与链接、战斗流程与全体动作、敌方表、我方改 HP / MP / TP、倒下 / 复活 / 回满、锁死与无敌禁用。
- `troops-pane.spec`：不再出现当前战斗区块。
- `routes.spec`：`/cheat/battle`。

## 8. 分期与状态

| 期  | 内容                                                                                                   | 状态   |
| --- | ------------------------------------------------------------------------------------------------------ | ------ |
| 1   | `battle` 分类、空状态、战斗流程、敌方表迁移、运行页链接、敌群页移除区块、导航小圆点                    | 已实现 |
| 2   | `BattleActorState` 推送、`BattleParty`、`actorVital` / `actorRevive` / `actorRecover`、锁死 / 无敌提示 | 已实现 |
| —   | 开战提示里的“打开战斗页”链接                                                                           | 未做   |

## 9. 风险 / 待验证

- 部分战斗插件（YEP_BattleEngineCore、横版 / ATB 系列、MOG 血条）自定义了状态窗或血条，`refreshStatus` 可能不足以刷新，需真实游戏抽查。
- TP 在关闭“显示 TP”的游戏里仍存在但玩家看不到；列头提示即可，不隐藏。
- 输入阶段复活的角色当回合可能没有指令，下一回合正常；需在 MV / MZ 各验证一次。
