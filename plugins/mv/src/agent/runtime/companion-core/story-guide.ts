import { chestEventOpened } from '../../event-facts'
import { isBenchmarkStoryGame } from './story-benchmark'
import type { ExplorationTarget } from './story-exploration'

export function benchmarkStoryGuide(
  mapId: number,
  playerPos: { x: number; y: number },
  playerGuidance: string | null | undefined,
  blocked: (eventId: number) => boolean,
  visited: (eventId: number) => boolean
): ExplorationTarget | null {
  if (!isBenchmarkStoryGame()) return null
  const engine = globalThis as any
  const party = engine.$gameParty
  if (!party) return null
  const switchOn = (id: number) => engine.$gameSwitches?.value?.(id) ?? false
  const variable = (id: number) => engine.$gameVariables?.value?.(id) ?? 0
  const target = (
    eventId: number,
    x: number,
    y: number,
    name: string,
    hint: string,
    priority = 100,
    kind: ExplorationTarget['kind'] = 'guide',
    guided = false
  ): ExplorationTarget => ({
    eventId,
    x,
    y,
    name,
    hint,
    priority,
    kind,
    guided,
  })
  if (mapId === 1) {
    const chest = () => target(3, 8, 8, 'Weapon Chest', '拾取盗贼匕首')
    const stairs = () => target(14, 15, 11, 'Secret Stairs', '进入试炼秘密地下室')
    if (playerGuidance && /宝箱|箱子|武器|匕首/i.test(playerGuidance) && !blocked(3)) return { ...chest(), priority: 150, guided: true }
    if (playerGuidance && /地下室|试炼|楼梯|暗门/i.test(playerGuidance) && !blocked(14)) return { ...stairs(), priority: 150, guided: true }
    const leader = party.leader?.()
    const weapon = engine.$dataWeapons?.[5]
    return leader && weapon && (leader.hasWeapon?.(weapon) || leader.isEquipped?.(weapon)) ? stairs() : chest()
  }
  if (mapId === 4) {
    const boris = () => target(5, 3, 4, 'Master Boris', '与会长鲍里斯对话')
    const cushion = () => target(15, 6, 8, 'Cushion Secret', '调查坐垫藏钱处')
    const door = () => target(17, 1, 7, 'Secret Passage Door', '穿过暗门进入试炼二区')
    if (playerGuidance && /会长|鲍里斯|交任务/i.test(playerGuidance) && !blocked(5)) return { ...boris(), priority: 150, guided: true }
    if (playerGuidance && /坐垫|垫子|沙发/i.test(playerGuidance) && !blocked(15)) return { ...cushion(), priority: 150, guided: true }
    if (playerGuidance && /暗门|二区|门/i.test(playerGuidance) && !blocked(17)) return { ...door(), priority: 150, guided: true }
    if ((party.gold?.() ?? 0) >= 50) return switchOn(6) ? door() : { ...boris(), hint: '提交50金币试炼任务' }
    const objectives = [
      { id: 7, x: 1, y: 11, name: 'Trial Chest 7', hint: '收集试炼金币 (1, 11)' },
      { id: 8, x: 10, y: 13, name: 'Trial Chest 8', hint: '收集试炼金币 (10, 13)' },
      { id: 12, x: 12, y: 11, name: 'Desk Note', hint: '阅读坐垫藏钱线索 (12, 11)' },
      { id: 15, x: 6, y: 8, name: 'Cushion Secret', hint: '获取坐垫下金币 (6, 8)' },
      { id: 13, x: 21, y: 3, name: 'Trial Chest 13', hint: '收集东厅金币 (21, 3)' },
      { id: 14, x: 20, y: 15, name: 'Trial Chest 14', hint: '收集东厅金币 (20, 15)' },
    ]
    const next = objectives.find((entry) => !(entry.id === 12 ? switchOn(7) : engine.$gameSelfSwitches?.value?.([4, entry.id, 'A'])) && !blocked(entry.id))
    return next ? target(next.id, next.x, next.y, next.name, next.hint) : null
  }
  if (mapId === 5) {
    const lever = () => target(12, 2, 3, 'Lever Switch', '拉动机关拉杆解除门锁')
    const elder = () => target(17, 5, 5, 'Shadow Elder', '触发影之长者试炼')
    if (playerGuidance && /拉杆|开关|机关/i.test(playerGuidance) && !blocked(12)) return { ...lever(), priority: 150, guided: true }
    if (playerGuidance && /长者|长老|老头|暗影/i.test(playerGuidance) && !blocked(17)) return { ...elder(), priority: 150, guided: true }
    if (!switchOn(12)) return target(2, 4, 11, 'Boris Briefing', '听取第二试炼简报')
    if (!switchOn(13)) return target(3, 6, 11, 'Rat Encounter', '推进试炼战斗')
    if (!switchOn(14)) return playerPos.x < 18 && playerPos.y >= 11 ? target(41, 18, 15, 'Sewer Passage', '穿过下水道走廊') : elder()
    if (!switchOn(23)) return lever()
    if (playerPos.y > 8) return target(10, 20, 10, 'Dungeon Door 10', '穿过解锁的门扉')
    if (playerPos.y > 3) return target(5, 20, 7, 'Passage Clearance', '清理通道提示')
    return target(26, 21, 3, 'Deep Dungeon Portal', '前往序章终点深处')
  }
  if (mapId !== 6 || switchOn(30) || switchOn(683)) return null
  if (switchOn(27)) {
    const count = variable(7)
    if (count < 4) {
      const offerings = [
        { id: 19, x: 28, y: 14 },
        { id: 17, x: 18, y: 25 },
        { id: 25, x: 30, y: 34 },
        { id: 28, x: 2, y: 34 },
      ]
      const next = offerings.find((entry) => {
        const event = engine.$gameMap?.event?.(entry.id)
        return event && !chestEventOpened(event, mapId, entry.id) && !blocked(entry.id)
      })
      if (next) return target(next.id, next.x, next.y, `Offering Chest #${next.id}`, `开启试炼宝箱 (${next.x}, ${next.y}) 获取拉维尔娜赐礼 (当前已收集 ${count}/4)`, 140, 'chest')
    } else {
      return visited(58)
        ? target(30, 3, 3, 'Statue of Laverna', '已集齐4份赐礼，前往拉维尔娜神坛 (3, 3) 供奉赐礼完成试炼', 140)
        : target(58, 3, 2, 'Statue of Laverna', '已集齐4份赐礼，前往拉维尔娜神坛 (3, 2) 供奉赐礼完成试炼', 150)
    }
  }
  if (switchOn(32)) return visited(14) ? target(58, 3, 2, 'Statue of Laverna', '前往拉维尔娜神坛接受赐福', 120) : target(14, 13, 7, 'Supply Cache', '调查闪光补给点', 130)
  if (!visited(9)) {
    const guided = Boolean(playerGuidance && /会长|序章|对话|交任务/i.test(playerGuidance))
    return target(9, 11, 7, 'Master Boris Climax', '与会长对话开启开锁试炼', guided ? 150 : 100, 'guide', guided)
  }
  if (variable(6) >= 3) return target(9, 11, 7, 'Master Boris Climax', '向会长汇报完成试炼', 120)
  const next = [
    { id: 7, x: 14, y: 7 },
    { id: 8, x: 13, y: 11 },
    { id: 6, x: 8, y: 10 },
  ].find((entry) => {
    const event = engine.$gameMap?.event?.(entry.id)
    return event && !chestEventOpened(event, mapId, entry.id)
  })
  return next ? target(next.id, next.x, next.y, `Trial Chest ${next.id}`, `开启试炼宝箱 (${next.x}, ${next.y})`, 110, 'chest') : null
}
