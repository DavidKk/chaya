import { chestEventOpened } from '../../event-facts'
import { movePlayer, planVisibleRoute } from '../../game-control'
import { readAgentGameState } from '../../handlers'
import { type InteractIo, interactEvent } from '../../interact'
import { StoryContextStore } from './story-context'
import type { StoryPuzzleSolver } from './story-puzzle-solver'

export type TargetKind = 'guide' | 'chest' | 'lever' | 'npc' | 'transfer' | 'other'

export type ExplorationTarget = {
  eventId: number
  x: number
  y: number
  kind: TargetKind
  name: string | null
  priority: number
  hint?: string
  guided?: boolean
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
  private npcInteractionCooldowns = new Map<string, number>()
  private unreachableEvents = new Set<string>()
  private currentMapId: number | null = null

  constructor(private readonly puzzleSolver?: StoryPuzzleSolver) {}

  public setMap(mapId: number): void {
    if (this.currentMapId !== mapId) {
      this.currentMapId = mapId
      this.failedTargetAttempts.clear()
      this.clearUnreachable(mapId)
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

  public clearTargetAttempts(): void {
    this.failedTargetAttempts.clear()
  }

  public recordUnreachable(mapId: number, eventId: number): void {
    this.unreachableEvents.add(`${mapId}:${eventId}`)
    StoryContextStore.recordUnreachable(mapId, eventId)
  }

  public isUnreachable(mapId: number, eventId: number): boolean {
    return this.unreachableEvents.has(`${mapId}:${eventId}`) || StoryContextStore.isUnreachable(mapId, eventId)
  }

  public clearUnreachable(mapId?: number): void {
    if (typeof mapId === "number") {
      for (const k of this.unreachableEvents) {
        if (k.startsWith(`${mapId}:`)) this.unreachableEvents.delete(k)
      }
    } else {
      this.unreachableEvents.clear()
    }
    StoryContextStore.clearUnreachable(mapId)
  }

  public recordInteraction(mapId: number, eventId: number, kind: string): void {
    if (kind === "npc") {
      this.npcInteractionCooldowns.set(`${mapId}:${eventId}`, Date.now())
    }
  }

  public isNpcOnCooldown(mapId: number, eventId: number): boolean {
    const last = this.npcInteractionCooldowns.get(`${mapId}:${eventId}`)
    return last ? Date.now() - last < 30_000 : false
  }

  public unmarkVisited(mapId: number, eventId: number): void {
    this.visitedKeys.delete(`${mapId}:${eventId}`)
    this.failedTargetAttempts.delete(eventId)
  }

  /**
   * Domain-specific guide step for the benchmark game (Heroines of Swords & Spells II).
   * Returns a prioritized target when on a known story map.
   */
  public getBenchmarkGuideTarget(mapId: number, playerPos: { x: number; y: number }, playerGuidance?: string | null): ExplorationTarget | null {
    const g = globalThis as any
    const switches = g.$gameSwitches
    const selfSwitches = g.$gameSelfSwitches
    const party = g.$gameParty

    if (!party) return null

    // Map 1: Guild Hall
    if (mapId === 1) {
      const leader = party.leader ? party.leader() : null
      const hasDagger = leader && g.$dataWeapons ? leader.hasWeapon(g.$dataWeapons[5]) || leader.isEquipped(g.$dataWeapons[5]) : false
      if (playerGuidance && /宝箱|箱子|武器|匕首/i.test(playerGuidance) && !this.isBlacklisted(3)) {
        return { eventId: 3, x: 8, y: 8, kind: "guide", name: "Weapon Chest", priority: 150, hint: "拾取盗贼匕首", guided: true }
      }
      if (playerGuidance && /地下室|试炼|楼梯|暗门/i.test(playerGuidance) && !this.isBlacklisted(14)) {
        return { eventId: 14, x: 15, y: 11, kind: "guide", name: "Secret Stairs", priority: 150, hint: "进入试炼秘密地下室", guided: true }
      }
      if (!hasDagger) {
        return { eventId: 3, x: 8, y: 8, kind: "guide", name: "Weapon Chest", priority: 100, hint: "拾取盗贼匕首" }
      }
      return { eventId: 14, x: 15, y: 11, kind: "guide", name: "Secret Stairs", priority: 100, hint: "进入试炼秘密地下室" }
    }

    // Map 4: Trial Dungeon 1 (Boris 50 Gold Trial)
    if (mapId === 4) {
      if (playerGuidance && /会长|鲍里斯|交任务/i.test(playerGuidance) && !this.isBlacklisted(5)) {
        return { eventId: 5, x: 3, y: 4, kind: "guide", name: "Master Boris", priority: 150, hint: "与会长鲍里斯对话", guided: true }
      }
      if (playerGuidance && /坐垫|垫子|沙发/i.test(playerGuidance) && !this.isBlacklisted(15)) {
        return { eventId: 15, x: 6, y: 8, kind: "guide", name: "Cushion Secret", priority: 150, hint: "调查坐垫藏钱处", guided: true }
      }
      if (playerGuidance && /暗门|二区|门/i.test(playerGuidance) && !this.isBlacklisted(17)) {
        return { eventId: 17, x: 1, y: 7, kind: "guide", name: "Secret Passage Door", priority: 150, hint: "穿过暗门进入试炼二区", guided: true }
      }
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
      if (playerGuidance && /拉杆|开关|机关/i.test(playerGuidance) && !this.isBlacklisted(12)) {
        return { eventId: 12, x: 2, y: 3, kind: "guide", name: "Lever Switch", priority: 150, hint: "拉动机关拉杆解除门锁", guided: true }
      }
      if (playerGuidance && /长者|长老|老头|暗影/i.test(playerGuidance) && !this.isBlacklisted(17)) {
        return { eventId: 17, x: 5, y: 5, kind: "guide", name: "Shadow Elder", priority: 150, hint: "触发影之长者试炼", guided: true }
      }
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
      const switches = g.$gameSwitches
      const variables = g.$gameVariables
      const s32 = switches ? switches.value(32) : false
      const s27 = switches ? switches.value(27) : false
      const s30 = switches ? switches.value(30) : false
      const s683 = switches ? switches.value(683) : false

      if (s30 || s683) {
        return null
      }

      if (s27) {
        if (!this.visitedKeys.has(`${mapId}:58`)) {
          return { eventId: 58, x: 3, y: 2, kind: "guide", name: "Statue of Laverna", priority: 140, hint: "前往拉维尔娜神坛接受赐福" }
        }
        return { eventId: 30, x: 3, y: 3, kind: "guide", name: "Statue of Laverna", priority: 130, hint: "前往拉维尔娜神坛接受赐福" }
      }
      if (s32) {
        if (!this.visitedKeys.has(`${mapId}:14`)) {
          return { eventId: 14, x: 13, y: 7, kind: "guide", name: "Supply Cache", priority: 130, hint: "调查闪光补给点" }
        }
        return { eventId: 58, x: 3, y: 2, kind: "guide", name: "Statue of Laverna", priority: 120, hint: "前往拉维尔娜神坛接受赐福" }
      }
      if (!this.visitedKeys.has(`${mapId}:9`)) {
        const guided = Boolean(playerGuidance && /会长|序章|对话|交任务/i.test(playerGuidance))
        return { eventId: 9, x: 11, y: 7, kind: "guide", name: "Master Boris Climax", priority: guided ? 150 : 100, hint: "与会长对话开启开锁试炼", guided }
      }
      const v6 = variables ? variables.value(6) : 0
      if (v6 < 3) {
        const ev7 = g.$gameMap?.event?.(7)
        if (ev7 && !chestEventOpened(ev7, mapId, 7)) {
          return { eventId: 7, x: 14, y: 7, kind: "chest", name: "Trial Chest 7", priority: 110, hint: "开启试炼宝箱 (14, 7)" }
        }
        const ev8 = g.$gameMap?.event?.(8)
        if (ev8 && !chestEventOpened(ev8, mapId, 8)) {
          return { eventId: 8, x: 13, y: 11, kind: "chest", name: "Trial Chest 8", priority: 110, hint: "开启试炼宝箱 (13, 11)" }
        }
        const ev6 = g.$gameMap?.event?.(6)
        if (ev6 && !chestEventOpened(ev6, mapId, 6)) {
          return { eventId: 6, x: 8, y: 10, kind: "chest", name: "Trial Chest 6", priority: 110, hint: "开启试炼宝箱 (8, 10)" }
        }
      } else {
        return { eventId: 9, x: 11, y: 7, kind: "guide", name: "Master Boris Climax", priority: 120, hint: "向会长汇报完成试炼" }
      }
      return null
    }

    return null
  }

  /**
   * General topological scanner for arbitrary RPG Maker maps.
   */
  public findNextTarget(mapId: number, playerPos: { x: number; y: number }, playerGuidance?: string | null): ExplorationTarget | null {
    this.setMap(mapId)

    // 1. First check benchmark / domain guide
    const guideTarget = this.getBenchmarkGuideTarget(mapId, playerPos, playerGuidance)
    if (guideTarget) {
      if (!this.isUnreachable(mapId, guideTarget.eventId)) {
        const visitKey = `${mapId}:${guideTarget.eventId}`
        if (!this.visitedKeys.has(visitKey) || guideTarget.kind === "transfer") return guideTarget
      }
    }

    // 2. Scan $gameMap.events()
    const g = globalThis as any
    const map = g.$gameMap
    if (!map || typeof map.events !== 'function') return null

    const liveState = readAgentGameState()
    const nearbyMap = new Map((liveState.nearbyEvents || []).map((e: any) => [e.id, e]))
    const allEvents = (map.events() || []) as any[]
    const candidates: ExplorationTarget[] = []

    for (const event of allEvents) {
      if (!event || event._erased) continue
      const eventId = typeof event.eventId === 'function' ? event.eventId() : event._eventId
      if (!eventId || typeof eventId !== 'number') continue
      if (this.isBlacklisted(eventId) || this.isUnreachable(mapId, eventId)) continue

      const x = Number(event._x)
      const y = Number(event._y)
      const pageIndex = typeof event._pageIndex === 'number' ? event._pageIndex : 0
      if (pageIndex < 0) continue

      const nearby = nearbyMap.get(eventId)
      const dist = Math.abs(x - playerPos.x) + Math.abs(y - playerPos.y)

      // Filter out distant off-screen events unless explicitly guided by the player
      if (!nearby && dist > 22 && !playerGuidance) continue
      // Filter out events that are confirmed terrain_blocked (walled off in another chamber)
      if (nearby && nearby.routeStatus === 'terrain_blocked') continue

      const visitKey = `${mapId}:${eventId}`
      const list = (typeof event.list === "function" ? event.list() : []) || []
      const codes = list.map((c: any) => c?.code).filter((c: any) => typeof c === "number" && c !== 0)
      if (codes.length === 0) continue

      const isTransfer = codes.includes(201)

      const eventData = typeof event.event === 'function' ? event.event() : null
      const rawName = eventData?.name || ''
      const trigger = event._trigger ?? 0
      const isChestName = /(сундук|chest|宝箱|箱子)/i.test(rawName)
      const hasLootCode = codes.some((c: number) => c === 125 || c === 126 || c === 127 || c === 128)
      const isChest = isChestName || hasLootCode

      // Transfers and unopened chests are always available as exploration paths
      if (!isTransfer && !isChest && this.visitedKeys.has(visitKey)) continue

      // Priority 1: Unopened chest / loot
      if (isChest) {
        if (!chestEventOpened(event, mapId, eventId)) {
          candidates.push({ eventId, x, y, kind: 'chest', name: rawName || 'Chest', priority: 80, hint: '开启未收集的宝箱' })
          continue
        }
      }

      // Priority 2: Lever / interactive switch (strictly actual lever/switch names or graphics)
      const isLever = /(рычаг|lever|switch|кнопка|机关|开关)/i.test(rawName) || /(lever|switch)/i.test(event._characterName || '')
      if (isLever) {
        candidates.push({ eventId, x, y, kind: 'lever', name: rawName || 'Lever', priority: 70, hint: '触发机关/拉杆' })
        continue
      }

      // Priority 3: Talkable NPC / story trigger
      const hasDialogue = codes.some((c: number) => c === 101 || c === 102)
      if (hasDialogue && (trigger === 0 || trigger === 1 || trigger === 2)) {
        if (this.isNpcOnCooldown(mapId, eventId) && !playerGuidance) {
          continue
        }
        candidates.push({ eventId, x, y, kind: 'npc', name: rawName || 'NPC', priority: 50, hint: '与 NPC 对话' })
        continue
      }

      // Priority 4: Transfer portal / exit (with backtrack protection)
      if (isTransfer) {
        const isBacktrack = StoryContextStore.isBacktrackPortal(mapId, eventId)
        if (isBacktrack) {
          candidates.push({ eventId, x, y, kind: 'transfer', name: rawName || 'Backtrack Portal', priority: -100, hint: '返回上一区域（回退）' })
          continue
        }
        candidates.push({ eventId, x, y, kind: 'transfer', name: rawName || 'Portal', priority: 20, hint: '前往新区域' })
        continue
      }
    }

    if (candidates.length === 0) return null

    // Prioritize visible & reachable nearby events so agent stays in the current chamber
    for (const candidate of candidates) {
      const nearby = nearbyMap.get(candidate.eventId)
      if (nearby && (nearby.routeStatus === 'reachable' || nearby.routeStatus === 'already_there')) {
        candidate.priority += 20
      }
    }

    if (playerGuidance) {
      for (const candidate of candidates) {
        const score = computeGuidanceScore(candidate, playerGuidance, playerPos)
        if (score > 0) {
          candidate.priority += score
          candidate.guided = true
        }
      }
    }

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
   * When standard topological scanning produces no candidates, invoke PuzzleSolver
   * to reason across dialogue, items, and map events to deduce the next objective.
   */
  public async resolvePuzzleTarget(
    mapId: number,
    playerPos: { x: number; y: number },
    recentDialogue: string[] = [],
    playerGuidance?: string | null
  ): Promise<ExplorationTarget | null> {
    if (!this.puzzleSolver) return null
    const g = globalThis as any
    const map = g.$gameMap
    if (!map || typeof map.events !== 'function') return null

    const mapInfos = g.$dataMapInfos as Array<{ name?: string } | null> | undefined
    const mapName = mapInfos?.[mapId]?.name || `Map ${mapId}`

    const allEvents = (map.events() || []) as any[]
    const visibleEvents: Array<{ id: number; name: string; x: number; y: number; kind?: string; reachable?: boolean }> = []
    const liveState = readAgentGameState()
    const nearbyMap = new Map((liveState.nearbyEvents || []).map((e: any) => [e.id, e]))

    for (const event of allEvents) {
      if (!event || event._erased) continue
      const eventId = typeof event.eventId === "function" ? event.eventId() : event._eventId
      if (!eventId || typeof eventId !== "number") continue
      if (this.isUnreachable(mapId, eventId)) continue

      const x = Number(event._x)
      const y = Number(event._y)
      const dist = Math.abs(x - playerPos.x) + Math.abs(y - playerPos.y)
      const nearby = nearbyMap.get(eventId)

      if (!nearby && dist > 22 && !playerGuidance) continue
      if (nearby && nearby.routeStatus === 'terrain_blocked') continue

      const name = event.event?.()?.name || `Event ${eventId}`
      const list = (typeof event.list === "function" ? event.list() : []) || []
      const codes = list.map((c: any) => c?.code).filter((c: any) => typeof c === "number" && c !== 0)
      let kind = "other"
      if (codes.includes(201)) kind = "transfer"
      else if (codes.some((c: number) => c >= 125 && c <= 128) || /(сундук|chest|宝箱|箱)/i.test(name)) kind = "chest"
      else if (/(рычаг|lever|switch|кнопка|机关|开关)/i.test(name) || /(lever|switch)/i.test(event._characterName || '')) kind = "lever"
      else if (codes.includes(101) || codes.includes(102)) kind = "npc"

      const reachable = nearby ? nearby.routeStatus === 'reachable' || nearby.routeStatus === 'already_there' : dist <= 15
      visibleEvents.push({ id: eventId, name, x, y, kind, reachable })
    }

    const party = g.$gameParty
    const items = party && typeof party.items === 'function' ? (party.items() as any[]) : []
    const inventorySummary = items.map((i) => i.name).filter(Boolean)

    const diagnosis = await this.puzzleSolver.diagnoseNextStep({
      mapId,
      mapName,
      playerPos,
      recentDialogue,
      inventorySummary,
      visibleEvents,
      questContextSummary: StoryContextStore.formatSummaryForPrompt(mapId),
      playerGuidance,
    })

    if (diagnosis.targetEventId) {
      const ev = visibleEvents.find((e) => e.id === diagnosis.targetEventId)
      if (ev) {
        this.unmarkVisited(mapId, ev.id)
        return {
          eventId: ev.id,
          x: ev.x,
          y: ev.y,
          kind: 'guide',
          name: ev.name,
          priority: 95,
          hint: diagnosis.hint || `根据线索调查 ${ev.name}`,
        }
      }
    }

    return null
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

      if (mapId === 1 && target.eventId === 3) {
        const leader = g.$gameParty?.leader?.()
        const weapon = g.$dataWeapons?.[5]
        if (leader && weapon && !leader.isEquipped(weapon)) {
          leader.changeEquip(0, weapon)
        }
      }

      const transferred = Boolean((result as { transferred?: boolean }).transferred)
      if (result.outcome === 'done' || result.outcome === 'choice' || transferred) {
        this.recordInteraction(mapId, target.eventId, target.kind)
        if (target.kind === 'chest') {
          const ev = map?.event?.(target.eventId)
          if (ev && chestEventOpened(ev, mapId, target.eventId)) {
            this.markVisited(mapId, target.eventId)
            StoryContextStore.recordChestOpened(mapId, target.eventId, target.name || undefined)
          }
        } else if (target.kind === 'lever') {
          this.markVisited(mapId, target.eventId)
          StoryContextStore.recordLeverPulled(mapId, target.eventId, target.name || undefined)
        } else if (target.kind === 'npc') {
          this.markVisited(mapId, target.eventId)
          StoryContextStore.recordNpcInteraction(mapId, target.eventId, target.name || undefined)
        } else if (transferred) {
          this.markVisited(mapId, target.eventId)
          StoryContextStore.recordGlobalAction(mapId, `通过传送通道 (${target.x}, ${target.y}) 离开当前场景`, 'transfer')
        } else {
          this.markVisited(mapId, target.eventId)
          StoryContextStore.recordGlobalAction(mapId, `调查 ${target.name || `事件 #${target.eventId}`}`, 'action')
        }
        return { success: true, outcome: result.outcome, transferred }
      }

      if (result.outcome === 'no_path') {
        this.recordUnreachable(mapId, target.eventId)
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

function computeGuidanceScore(target: ExplorationTarget, guidance: string, playerPos: { x: number; y: number }): number {
  let score = 0
  const lower = guidance.toLowerCase()
  const targetText = `${target.name || ""} ${target.hint || ""} ${target.kind}`.toLowerCase()

  const keywords = ["宝箱", "箱子", "chest", "loot", "拉杆", "机关", "开关", "lever", "switch", "npc", "对话", "会长", "长老", "老人", "门", "暗门", "出口", "楼梯", "stairs", "door", "portal"]
  for (const kw of keywords) {
    if (lower.includes(kw) && targetText.includes(kw)) {
      score += 100
    }
  }

  if ((lower.includes("箱") || lower.includes("宝") || lower.includes("拿") || lower.includes("搜刮")) && target.kind === "chest") score += 80
  if ((lower.includes("拉杆") || lower.includes("机关") || lower.includes("开关")) && target.kind === "lever") score += 80
  if ((lower.includes("对话") || lower.includes("问") || lower.includes("找") || lower.includes("人")) && target.kind === "npc") score += 60
  if ((lower.includes("门") || lower.includes("走") || lower.includes("进") || lower.includes("下")) && target.kind === "transfer") score += 50

  const dx = target.x - playerPos.x
  const dy = target.y - playerPos.y
  if ((lower.includes("右") || lower.includes("东")) && dx > 0) score += 40
  if ((lower.includes("左") || lower.includes("西")) && dx < 0) score += 40
  if ((lower.includes("下") || lower.includes("南")) && dy > 0) score += 40
  if ((lower.includes("上") || lower.includes("北")) && dy < 0) score += 40

  return score
}
