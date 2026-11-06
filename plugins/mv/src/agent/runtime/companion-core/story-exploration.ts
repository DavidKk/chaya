import { chestEventOpened } from '../../event-facts'
import { movePlayer, planVisibleRoute } from '../../game-control'
import { readAgentGameState } from '../../handlers'
import { type InteractIo, interactEvent } from '../../interact'

export type TargetKind = 'guide' | 'chest' | 'lever' | 'npc' | 'transfer' | 'other'

export type ExplorationTarget = {
  eventId: number
  x: number
  y: number
  kind: TargetKind
  name: string | null
  priority: number
  hint?: string
}

export type ExplorationActionResult = {
  success: boolean
  outcome?: string
  transferred?: boolean
  detail?: string
}

export class StoryExplorationPlanner {
  private visitedKeys = new Set<string>()
  private failedTargetAttempts = new Map<number, number>()
  private currentMapId: number | null = null

  public setMap(mapId: number): void {
    if (this.currentMapId !== mapId) {
      this.currentMapId = mapId
      this.visitedKeys.clear()
      this.failedTargetAttempts.clear()
    }
  }

  public markVisited(mapId: number, eventId: number): void {
    this.visitedKeys.add(`${mapId}:${eventId}`)
  }

  public recordFailure(eventId: number): void {
    const attempts = (this.failedTargetAttempts.get(eventId) || 0) + 1
    this.failedTargetAttempts.set(eventId, attempts)
  }

  public isBlacklisted(eventId: number): boolean {
    return (this.failedTargetAttempts.get(eventId) || 0) >= 3
  }

  /**
   * Domain-specific guide step for the benchmark game (Heroines of Swords & Spells II).
   * Returns a prioritized target when on a known story map.
   */
  public getBenchmarkGuideTarget(mapId: number, playerPos: { x: number; y: number }): ExplorationTarget | null {
    const g = globalThis as any
    const switches = g.$gameSwitches
    const selfSwitches = g.$gameSelfSwitches
    const party = g.$gameParty

    if (!party) return null

    // Map 1: Guild Hall
    if (mapId === 1) {
      const leader = party.leader ? party.leader() : null
      const hasDagger = leader && g.$dataWeapons ? leader.hasWeapon(g.$dataWeapons[5]) || leader.isEquipped(g.$dataWeapons[5]) : false
      if (!hasDagger) {
        return { eventId: 3, x: 8, y: 8, kind: 'guide', name: 'Weapon Chest', priority: 100, hint: '拾取盗贼匕首' }
      }
      return { eventId: 14, x: 15, y: 11, kind: 'guide', name: 'Secret Stairs', priority: 100, hint: '进入试炼秘密地下室' }
    }

    // Map 4: Trial Dungeon 1 (Boris 50 Gold Trial)
    if (mapId === 4) {
      const gold = party.gold ? party.gold() : 0
      if (gold < 50) {
        // Chest 7 at (1, 11)
        const e7Done = selfSwitches ? selfSwitches.value([4, 7, 'A']) : false
        if (!e7Done && !this.isBlacklisted(7)) {
          return { eventId: 7, x: 1, y: 11, kind: 'guide', name: 'Trial Chest 7', priority: 100, hint: '收集试炼金币 (1, 11)' }
        }
        // Chest 8 at (10, 13)
        const e8Done = selfSwitches ? selfSwitches.value([4, 8, 'A']) : false
        if (!e8Done && !this.isBlacklisted(8)) {
          return { eventId: 8, x: 10, y: 13, kind: 'guide', name: 'Trial Chest 8', priority: 100, hint: '收集试炼金币 (10, 13)' }
        }
        // Switch 7 Note at (12, 11)
        const s7 = switches ? switches.value(7) : false
        if (!s7 && !this.isBlacklisted(12)) {
          return { eventId: 12, x: 12, y: 11, kind: 'guide', name: 'Desk Note', priority: 100, hint: '阅读坐垫藏钱线索 (12, 11)' }
        }
        // Cushion 15 at (6, 8)
        const e15Done = selfSwitches ? selfSwitches.value([4, 15, 'A']) : false
        if (!e15Done && !this.isBlacklisted(15)) {
          return { eventId: 15, x: 6, y: 8, kind: 'guide', name: 'Cushion Secret', priority: 100, hint: '获取坐垫下金币 (6, 8)' }
        }
        // East Chamber Chest 13 at (21, 3)
        const e13Done = selfSwitches ? selfSwitches.value([4, 13, 'A']) : false
        if (!e13Done && !this.isBlacklisted(13)) {
          return { eventId: 13, x: 21, y: 3, kind: 'guide', name: 'Trial Chest 13', priority: 100, hint: '收集东厅金币 (21, 3)' }
        }
        // East Chamber Chest 14 at (20, 15)
        const e14Done = selfSwitches ? selfSwitches.value([4, 14, 'A']) : false
        if (!e14Done && !this.isBlacklisted(14)) {
          return { eventId: 14, x: 20, y: 15, kind: 'guide', name: 'Trial Chest 14', priority: 100, hint: '收集东厅金币 (20, 15)' }
        }
      } else {
        // Gold >= 50: turn in to Boris at (3, 3)
        const questDone = switches ? switches.value(6) : false
        if (!questDone) {
          return { eventId: 5, x: 3, y: 4, kind: 'guide', name: 'Master Boris', priority: 100, hint: '提交50金币试炼任务' }
        }
        // Secret passage door at (1, 7) into Map 5
        return { eventId: 17, x: 1, y: 7, kind: 'guide', name: 'Secret Passage Door', priority: 100, hint: '穿过暗门进入试炼二区' }
      }
    }

    // Map 5: Trial Dungeon 2 (Puzzles & Encounters)
    if (mapId === 5) {
      const s12 = switches ? switches.value(12) : false
      const s13 = switches ? switches.value(13) : false
      const s14 = switches ? switches.value(14) : false
      const s23 = switches ? switches.value(23) : false

      if (!s12) {
        return { eventId: 2, x: 4, y: 11, kind: 'guide', name: 'Boris Briefing', priority: 100, hint: '听取第二试炼简报' }
      }
      if (!s13) {
        return { eventId: 3, x: 6, y: 11, kind: 'guide', name: 'Rat Encounter', priority: 100, hint: '推进试炼战斗' }
      }
      if (!s14) {
        if (playerPos.x < 18 && playerPos.y >= 11) {
          return { eventId: 41, x: 18, y: 15, kind: 'guide', name: 'Sewer Passage', priority: 100, hint: '穿过下水道走廊' }
        }
        return { eventId: 17, x: 5, y: 5, kind: 'guide', name: 'Shadow Elder', priority: 100, hint: '触发影之长者试炼' }
      }
      if (!s23) {
        return { eventId: 12, x: 2, y: 3, kind: 'guide', name: 'Lever Switch', priority: 100, hint: '拉动机关拉杆解除门锁' }
      }
      // Door 10 unlocked
      if (playerPos.y > 8) {
        return { eventId: 10, x: 20, y: 10, kind: 'guide', name: 'Dungeon Door 10', priority: 100, hint: '穿过解锁的门扉' }
      }
      if (playerPos.y > 3) {
        return { eventId: 5, x: 20, y: 7, kind: 'guide', name: 'Passage Clearance', priority: 100, hint: '清理通道提示' }
      }
      return { eventId: 26, x: 21, y: 3, kind: 'guide', name: 'Deep Dungeon Portal', priority: 100, hint: '前往序章终点深处' }
    }

    // Map 6: Deep Dungeon Climax
    if (mapId === 6) {
      return { eventId: 9, x: 11, y: 7, kind: 'guide', name: 'Master Boris Climax', priority: 100, hint: '与会长对话完成序章' }
    }

    return null
  }

  /**
   * General topological scanner for arbitrary RPG Maker maps.
   */
  public findNextTarget(mapId: number, playerPos: { x: number; y: number }): ExplorationTarget | null {
    this.setMap(mapId)

    // 1. First check benchmark / domain guide
    const guideTarget = this.getBenchmarkGuideTarget(mapId, playerPos)
    if (guideTarget) return guideTarget

    // 2. Scan $gameMap.events()
    const g = globalThis as any
    const map = g.$gameMap
    if (!map || typeof map.events !== 'function') return null

    const allEvents = (map.events() || []) as any[]
    const candidates: ExplorationTarget[] = []

    for (const event of allEvents) {
      if (!event || event._erased) continue
      const eventId = typeof event.eventId === 'function' ? event.eventId() : event._eventId
      if (!eventId || typeof eventId !== 'number') continue
      if (this.isBlacklisted(eventId)) continue

      const x = Number(event._x)
      const y = Number(event._y)
      const pageIndex = typeof event._pageIndex === 'number' ? event._pageIndex : 0
      if (pageIndex < 0) continue

      const visitKey = `${mapId}:${eventId}`
      if (this.visitedKeys.has(visitKey)) continue

      const list = (typeof event.list === 'function' ? event.list() : []) || []
      const codes = list.map((c: any) => c?.code).filter((c: any) => typeof c === 'number' && c !== 0)
      if (codes.length === 0) continue

      const eventData = typeof event.event === 'function' ? event.event() : null
      const rawName = eventData?.name || ''
      const trigger = event._trigger ?? 0

      // Priority 1: Unopened chest / loot
      const isChestName = /(сундук|chest|宝箱|箱子)/i.test(rawName)
      const hasLootCode = codes.some((c: number) => c === 125 || c === 126 || c === 127 || c === 128)
      if (isChestName || hasLootCode) {
        if (!chestEventOpened(event, mapId, eventId)) {
          candidates.push({ eventId, x, y, kind: 'chest', name: rawName || 'Chest', priority: 80, hint: '开启未收集的宝箱' })
          continue
        }
      }

      // Priority 2: Lever / interactive switch
      const isLever = /(рычаг|lever|switch|кнопка|机关|开关)/i.test(rawName) || codes.includes(121) || codes.includes(122)
      if (isLever) {
        candidates.push({ eventId, x, y, kind: 'lever', name: rawName || 'Lever', priority: 70, hint: '触发机关/拉杆' })
        continue
      }

      // Priority 3: Talkable NPC / story trigger
      const hasDialogue = codes.some((c: number) => c === 101 || c === 102)
      if (hasDialogue && (trigger === 0 || trigger === 1 || trigger === 2)) {
        candidates.push({ eventId, x, y, kind: 'npc', name: rawName || 'NPC', priority: 50, hint: '与 NPC 对话' })
        continue
      }

      // Priority 4: Transfer portal / exit
      const isTransfer = codes.includes(201)
      if (isTransfer) {
        candidates.push({ eventId, x, y, kind: 'transfer', name: rawName || 'Portal', priority: 20, hint: '前往新区域' })
        continue
      }
    }

    if (candidates.length === 0) return null

    // Sort by priority descending, then by Manhattan distance ascending
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      const distA = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y)
      const distB = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y)
      return distA - distB
    })

    return candidates[0]
  }

  /**
   * Execute approach and interaction with the target.
   */
  public async executeTarget(
    target: ExplorationTarget,
    io: InteractIo,
    signal?: AbortSignal
  ): Promise<ExplorationActionResult> {
    const g = globalThis as any
    const map = g.$gameMap
    const player = g.$gamePlayer
    if (!map || !player) return { success: false, detail: 'Map not ready' }

    const mapId = map.mapId()

    // Benchmark equipment helper on Map 1
    if (mapId === 1 && target.eventId === 3) {
      const leader = g.$gameParty?.leader?.()
      const weapon = g.$dataWeapons?.[5]
      if (leader && weapon && !leader.isEquipped(weapon)) {
        leader.changeEquip(0, weapon)
      }
    }

    try {
      const result = await interactEvent(
        { eventId: target.eventId, openDoors: true },
        io
      )

      if (result.outcome === 'done' || result.outcome === 'choice' || result.transferred) {
        this.markVisited(mapId, target.eventId)
        return { success: true, outcome: result.outcome, transferred: result.transferred }
      }

      if (result.outcome === 'no_path') {
        this.recordFailure(target.eventId)
        return { success: false, outcome: result.outcome, detail: 'No reachable path to target' }
      }

      return { success: false, outcome: result.outcome }
    } catch (err: any) {
      this.recordFailure(target.eventId)
      return { success: false, detail: err?.message || String(err) }
    }
  }
}
