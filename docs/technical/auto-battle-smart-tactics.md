# RPG Maker 自动战斗情境决策与智能战术技术方案

- **日期**：2026-10-31
- **状态**：已落地（已实现并通过测试验证）
- **对应需求**：[`../auto-battle-smart-tactics.md`](../auto-battle-smart-tactics.md)
- **关联模块**：`plugins/mv/src/cheat/runtime/auto-battle.ts`、`plugins/rgss/edit_runtime.rb`、`components/game-edit/battle/BattlePane.tsx`
- **有效范围**：覆盖 RPG Maker MV / MZ 与 RGSS2 / RGSS3 下自动战斗（`autoBattle`）的运行时钩子接管、跨菜单动作打平、情境感知决策流与受限状态安全兜底。

---

## 1. 总体架构与调用链路

```text
[用户开启 autoBattle 开关 / 快捷键]
             │
             ▼
 [tryAutoBattle (MV/MZ) / tick_auto_battle (RGSS)]
             │
   ┌─────────┴─────────┐
   │ 安全栅栏门禁检查   │
   │ 1. !enabled || autoWin? -> 退出
   │ 2. troop_event_running? -> 退出 (等待剧情/对话)
   │ 3. message_busy?        -> 退出 (等待战斗消息)
   │ 4. phase != 'input'     -> 退出 (仅在指令输入期行动)
   └─────────┬─────────┘
             │
             ▼
 [接管 makeAutoBattleActions / make_smart_actions]
             │
  ┌──────────┴───────────────────────────────────────────────────────┐
  │ 遍历当前行动槽位 i = 0 ... numActions - 1                         │
  │                                                                   │
  │ 1. 自身限制感知 (Disarm / Silence / Cost)                         │
  │    - 探测 canAttack() (是否被缴械/攻击封印)                         │
  │    - 提取 usableSkills() (已过滤无蓝/无怒气/封印类型)              │
  │                                                                   │
  │ 2. 团队生命危机感知 (Crisis Intervention)                         │
  │    - 扫描全队生命比例 minHpRate                                   │
  │    - 若有死亡队友 & 有可用复活技能 -> action.setSkill(reviveId)    │
  │    - 若 minHpRate < 0.4 & 有可用治疗 -> action.setSkill(healId)   │
  │                                                                   │
  │ 3. 敌群态势与输出决策 (Offense & AoE)                              │
  │    - 存活敌人 >= 2 & 拥有可用全体技能 -> 优先群体技能              │
  │    - 单体目标：安全计算各技能期望伤害，高于普攻 1.2x 优先放技能    │
  │    - 剔除 Math.random() 0~1 的强噪声，防止普攻随机反超            │
  │                                                                   │
  │ 4. 优雅兜底降级 (Graceful Fallback)                               │
  │    - 普攻可用 -> action.setAttack()                               │
  │    - 普攻被缴械 & 无可用技能 -> action.setGuard() (防御)          │
  └──────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
                [关闭输入窗口 & BattleManager.startTurn()]
```

---

## 2. 核心模块与接管设计

### 2.1 MV / MZ 运行时接管 (`plugins/mv/src/cheat/runtime/auto-battle.ts`)

在现有的 `ensureAutoBattleActorHook` 基础上，扩展对 `Game_Actor.prototype.makeAutoBattleActions` 的代理拦截：

```ts
export function ensureAutoBattleActorHook(forced: () => boolean) {
  const proto = g().Game_Actor?.prototype
  if (!proto) return

  // 1. 保持原有 isAutoBattle 挂钩，使 BattleManager.startInput 能自动将角色标记为自动决策
  if (typeof proto.isAutoBattle === 'function' && !proto.__chayaAutoBattle) {
    const originalIsAutoBattle = proto.isAutoBattle
    proto.isAutoBattle = function (this: unknown) {
      if (forced()) return true
      return originalIsAutoBattle.call(this)
    }
    proto.__chayaAutoBattle = true
  }

  // 2. 挂钩 makeAutoBattleActions，注入 Chaya 智能决策流水线
  if (typeof proto.makeAutoBattleActions === 'function' && !proto.__chayaSmartBattle) {
    const originalMakeActions = proto.makeAutoBattleActions
    proto.makeAutoBattleActions = function (this: any) {
      if (forced()) {
        makeSmartAutoBattleActions(this)
        return
      }
      originalMakeActions.call(this)
    }
    proto.__chayaSmartBattle = true
  }
}
```

### 2.2 跨菜单技能打平与安全评估 (`makeSmartAutoBattleActions`)

#### （1）动作与目标安全性抽取

```ts
export function makeSmartAutoBattleActions(actor: any) {
  // 若角色处于混乱/魅惑状态，优先执行原生混乱行为
  if (typeof actor.isConfusion === 'function' && actor.isConfusion()) {
    actor.makeConfusionActions?.()
    return
  }
  const numActions = typeof actor.numActions === 'function' ? actor.numActions() : 1
  // 跨槽位虚拟资源扣除跟踪，防止多动角色第二个动作因空蓝而施法失败
  let virtualMp = typeof actor.mp === 'number' ? actor.mp : 9999
  let virtualTp = typeof actor.tp === 'number' ? actor.tp : 9999

  for (let i = 0; i < numActions; i++) {
    const action = selectBestAction(actor, virtualMp, virtualTp)
    if (action?._item?.isSkill?.()) {
      const skill = action.item?.()
      if (skill) {
        virtualMp -= typeof actor.skillMpCost === 'function' ? actor.skillMpCost(skill) : skill.mpCost || 0
        virtualTp -= typeof actor.skillTpCost === 'function' ? actor.skillTpCost(skill) : skill.tpCost || 0
      }
    }
    if (typeof actor.setAction === 'function') {
      actor.setAction(i, action)
    }
  }
  actor.setActionState?.('waiting')
}
```

#### （2）多维决策流水线 (`selectBestAction`)

```ts
function selectBestAction(actor: any, availableMp: number, availableTp: number): any {
  const ActionClass = g().Game_Action || (globalThis as any).Game_Action
  const action = new ActionClass(actor)

  // 1. 状态与能力检查
  const canAttack = typeof actor.canAttack === 'function' ? actor.canAttack() : true
  const allUsableSkills: any[] = typeof actor.usableSkills === 'function' ? actor.usableSkills() : []
  // 过滤满足多槽位虚拟资源扣除的技能
  const usableSkills = allUsableSkills.filter((s) => {
    const mpCost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(s) : s.mpCost || 0
    const tpCost = typeof actor.skillTpCost === 'function' ? actor.skillTpCost(s) : s.tpCost || 0
    return mpCost <= availableMp && tpCost <= availableTp
  })

  const party = g().$gameParty
  const troop = g().$gameTroop
  const aliveAllies = party?.aliveMembers?.() ?? []
  const deadAllies = party?.deadMembers?.() ?? []
  const aliveEnemies = troop?.aliveMembers?.() ?? []

  // 2. 救急检查：复活与低血量回复
  if (deadAllies.length > 0) {
    const reviveSkill = usableSkills.find((s) => isReviveSkill(s))
    if (reviveSkill) {
      action.setSkill(reviveSkill.id)
      action.setTarget(deadAllies[0].index())
      return action
    }
  }

  const lowestHpAlly = findLowestHpRateMember(aliveAllies)
  if (lowestHpAlly && lowestHpAlly.hp / Math.max(lowestHpAlly.mhp, 1) < 0.4) {
    const healSkill = usableSkills.find((s) => isHealingSkill(s))
    if (healSkill) {
      action.setSkill(healSkill.id)
      action.setTarget(lowestHpAlly.index())
      return action
    }
  }

  // 3. 敌群态势检查：群怪 AOE 压制
  if (aliveEnemies.length >= 2) {
    const aoeSkill = usableSkills.find((s) => isAoeAttackSkill(s, action))
    if (aoeSkill) {
      action.setSkill(aoeSkill.id)
      return action
    }
  }

  // 4. 优势伤害技能评估（去除 0~1 随机数扰动）
  let bestSkill: any = null
  let maxSkillDamage = 0
  let bestTargetIndex = aliveEnemies[0]?.index?.() ?? 0

  for (const skill of usableSkills) {
    if (!isDamageSkill(skill)) continue
    action.setSkill(skill.id)
    for (const enemy of aliveEnemies) {
      const dmg = safeEvaluateDamage(action, enemy)
      if (dmg > maxSkillDamage) {
        maxSkillDamage = dmg
        bestSkill = skill
        bestTargetIndex = enemy.index()
      }
    }
  }

  // 计算普攻基准伤害（若普攻可用）
  let attackDmg = 0
  if (canAttack) {
    action.setAttack()
    attackDmg = safeEvaluateDamage(action, aliveEnemies[0])
  }

  // 若技能伤害明显高于普攻（或已被缴械无法普攻），优先放技能
  if (bestSkill && (!canAttack || maxSkillDamage > attackDmg * 1.15)) {
    action.setSkill(bestSkill.id)
    action.setTarget(bestTargetIndex)
    return action
  }

  // 5. 普攻可用时执行普攻
  if (canAttack && aliveEnemies.length > 0) {
    action.setAttack()
    action.setTarget(aliveEnemies[0].index())
    return action
  }

  // 6. 受限防御兜底（缴械且无可用技能时，执行防御杜绝卡死）
  if (typeof action.setGuard === 'function') {
    action.setGuard()
  } else {
    action.setAttack()
  }
  return action
}
```

---

---

## 3. 物品系统解析与匹配算法设计

### 3.1 物品作用与恢复量探测 (`estimateRecovery`)

RPG Maker 中技能与物品通过 `damage` 与 `effects` 承载效果：

- **HP 恢复**：
  1. `item.damage.type === 3`：通过伤害公式计算恢复值；
  2. `item.effects` 中 `code === 11`（HP 恢复）：`恢复量 = target.mhp * effect.value1 + effect.value2`。
- **MP 恢复**：
  1. `item.damage.type === 4`：通过公式计算 MP 回复；
  2. `item.effects` 中 `code === 12`（MP 恢复）：`恢复量 = target.mmp * effect.value1 + effect.value2`。
- **投掷与攻击道具**：
  `item.scope in [1, 2]`（单体/全体敌方）且 `item.damage.type in [1, 5]`（HP 伤害/吸收）。

### 3.2 动态血量缺口匹配算法 (`matchBestHealingItem`)

目标生命缺口为 `deficit = target.mhp - target.hp`：

- **过期低效淘汰过滤器**：
  若满足以下条件，判定为前期残存低效道具，予以剔除：
  `recovery < target.mhp * 0.08 && deficit > 300 && recovery < deficit * 0.20`
  _(例：角色 MHP 4000，当前缺 2000 血，恢复 50 血的草药仅能弥补 2.5% 的缺口，不值得消耗一次行动机会)_。
- **适配度打分机制**：
  对于未被淘汰的候选道具，评估其恢复量与缺口的匹配程度：
  - 若 `recovery <= deficit`：评分以覆盖率为准 `score = recovery / deficit`（越接近 1.0 越佳）；
  - 若 `recovery > deficit`：对溢出部分施加适度衰减，如 `score = 1.0 - (recovery - deficit) / Math.max(recovery, 1) * 0.5`，防止用大红药救轻伤。

### 3.3 技能与道具的层级关系

- **默认优先使用技能**：技能属于战斗内可循环/可再生资源，物品属于不可逆消耗品；只要角色拥有满足蓝量的可用治疗技能，绝不滥用背包物品。
- **道具调取触发时机**：
  1. **急救无技能**：低血队友需要治疗，但当前角色无治疗技能或已空蓝；
  2. **MP 续航维持**：法系输出角色 `mp / mmp < 0.25` 时，且战局平稳，使用回蓝道具（如以太）；
  3. **受限输出补充**：被缴械且无技能时，优先使用投掷伤害道具打击敌人，而非直接防御。

## 4. 辅助判据与异常防护

### 3.1 技能意图识别安全辅助

```ts
function isDamageSkill(skill: any): boolean {
  return skill && skill.damage && skill.damage.type > 0 && [1, 5].includes(skill.damage.type)
}

function isHealingSkill(skill: any, user: any, target: any): boolean {
  if (!skill) return false
  // Scope 11 为自身，目标非自身时不能作为急救技能
  if (skill.scope === 11 && target !== user) return false
  return estimateHpRecovery(skill, user, target) > 0 || skill.damage?.type === 3
}

function isReviveSkill(skill: any): boolean {
  // scope 9: 1 dead ally, scope 10: all dead allies
  return skill && (skill.scope === 9 || skill.scope === 10)
}

function isAoeAttackSkill(skill: any, action: any): boolean {
  if (!isDamageSkill(skill)) return false
  // scope 2: all enemies
  return skill.scope === 2
}
```

### 3.2 伤害预估安全沙箱 (`safeEvaluateDamage`)

由于 Yanfly 等插件可能在伤害公式 eval 中读取未初始化的动作阶段属性，伤害计算必须具备严格的降级容错：

```ts
function safeEvaluateDamage(action: any, target: any): number {
  if (!target) return 0
  const item = action.item?.()
  const damage = item?.damage
  const variance = damage?.variance
  try {
    if (typeof action.makeDamageValue === 'function') {
      // 预估时去掉标准伤害浮动，避免同一回合随机反超技能收益
      if (damage && typeof damage === 'object') damage.variance = 0
      let val: number
      try {
        val = action.makeDamageValue(target)
      } catch {
        val = action.makeDamageValue(target, false)
      }
      return typeof val === 'number' && !isNaN(val) ? Math.max(val, 0) : 0
    }
  } catch {
    // 捕获公式中访问未定义上下文抛出的异常
  } finally {
    if (damage && typeof damage === 'object') damage.variance = variance
  }
  return 0
}
```

---

## 5. RGSS（Ruby）端适配设计

在 `plugins/rgss/edit_runtime.rb` 中，升级 `tick_auto_battle`：

```ruby
def tick_auto_battle
  return unless auto_battle? && !auto_win?
  scene = live_battle_scene
  return unless scene
  return if troop_event_running? || battle_message_busy?
  phase = BattleManager.instance_variable_get(:@phase) rescue nil
  return unless phase == :input

  if defined?($game_party) && $game_party.respond_to?(:battle_members)
    $game_party.battle_members.each do |actor|
      next unless actor
      next if actor.respond_to?(:movable?) && !actor.movable?
      smart_auto_battle_actions(actor)
    end
  end

  close_battle_windows(scene)
  BattleManager.start_turn if BattleManager.respond_to?(:start_turn)
end
```

`smart_auto_battle_actions(actor)` 遵循相同行为树：

1. 检查 `actor.attack_usable?`；
2. 检查全队血量低者与技能回复；
3. 评估敌群数量与技能伤害；
4. 处于缴械状态且无技能时，执行 `action.set_guard`。

---

## 6. 测试用例与验收标准

针对修改扩充 `__tests__/plugins/cheat/runtime/auto-battle.spec.ts`：

1. **缴械兜底测试**：`actor.canAttack() === false` 且无可用技能时，`action.setGuard` 被调用，绝不调用 `setAttack`。
2. **缴械释放技能测试**：`actor.canAttack() === false` 但有可用技能时，正确选取并释放该技能。
3. **救急治疗测试**：队友生命低于 40% 时，优先选择可用恢复技能并以该队友为目标。
4. **群怪 AOE 测试**：敌人数量 >= 2 时，优先选择范围为全体的伤害技能。
5. **插件崩溃容错测试**：模拟技能伤害公式抛出异常时，代码不崩溃，平稳降级至安全备选方案。
6. **全量回归保障**：原有 `isAutoBattle` 强制开关与回合推进用例全绿通过。
