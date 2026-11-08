import { chestEventOpened } from '../../event-facts'
import { readAgentGameState } from '../../handlers'
import type { InteractIo } from '../../interact'
import { StoryTargetExecutor } from './story-actions'
import { isBenchmarkStoryGame } from './story-benchmark'
import { StoryContextStore } from './story-context'
import { detectStaticLockRequirement, hasRewardCommand, interactionKind, isCompletedEvent, isTrapEvent } from './story-eligibility'
import { StoryFailureMemory } from './story-failure-memory'
import { computeGuidanceScore, positiveStoryGuidance, storyMapExitAllowed, storyTravelPolicy } from './story-guidance'
import { benchmarkStoryGuide } from './story-guide'
import type { StoryLoopDetector } from './story-loop-detector'
import { storyApproachEvent } from './story-navigation'
import type { StoryPuzzleSolver } from './story-puzzle-solver'
import { resolveStoryPuzzleTarget } from './story-puzzle-target'
import type { StoryRetryCondition } from './story-retry-facts'
import { buildStoryRoutes, storyExpectedLockGain, type StoryRoutePlan } from './story-routes'
import { isStoryMapExit } from './story-transfer'

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
  pending?: boolean
  outcome?: string
  transferred?: boolean
  detail?: string
}

export class StoryExplorationPlanner {
  private visitedKeys = new Set<string>()
  private npcInteractionCooldowns = new Map<string, number>()
  private unreachableEvents = new Set<string>()
  private currentMapId: number | null = null
  private readonly executor = new StoryTargetExecutor(this, (mapId) => this.getLoopDetector(mapId))
  private lastKnownLockLevels = new Map<number, number>()
  private lastLockBonusTargets = new Set<number>()
  private contextOwner = (globalThis as any).$gameSystem
  private playerGuidance: string | null = null
  public routes: StoryRoutePlan[] = []

  constructor(private readonly puzzleSolver?: StoryPuzzleSolver) {}

  public setPlayerGuidance(text: string | null): void {
    this.playerGuidance = text
    const pendingId = this.pendingEventId
    const mapId = (globalThis as any).$gameMap?.mapId?.() ?? 0
    if (pendingId !== null && !this.isEligible(mapId, pendingId)) this.executor.reset()
  }

  private get loopDetector(): StoryLoopDetector {
    return this.getLoopDetector(this.currentMapId ?? 0)
  }

  private getLoopDetector(mapId: number): StoryLoopDetector {
    return StoryFailureMemory.loopDetector(mapId)
  }

  public isEligible(mapId: number, eventId: number): boolean {
    this.setMap(mapId)
    const engine = globalThis as any
    const event = engine.$gameMap?.event?.(eventId)
    if (!event || event._erased || event._pageIndex < 0 || this.isBlacklisted(eventId) || this.isUnreachable(mapId, eventId)) return false
    if (interactionKind(event) === 'chest' && isCompletedEvent(event, mapId, eventId)) return false
    if (isTrapEvent(event) && isCompletedEvent(event, mapId, eventId)) return false
    if (
      isStoryMapExit(event, mapId) &&
      !storyMapExitAllowed(event, mapId, storyTravelPolicy(this.playerGuidance), (destination) => StoryContextStore.isBacktrackPortal(mapId, eventId, destination ?? undefined))
    )
      return false
    if (isBenchmarkStoryGame()) {
      const level = engine.$gameVariables?.value?.(3) ?? 0
      const prerequisite = StoryContextStore.getLockPrerequisite(mapId, eventId)
      if (prerequisite && prerequisite.requiredLevel > level) return false
      const requirement = detectStaticLockRequirement(event)
      if (requirement !== null && requirement > level) {
        StoryContextStore.recordLockPrerequisite(mapId, eventId, isTrapEvent(event) ? 'trap' : 'chest', requirement, level)
        return false
      }
    }
    return true
  }

  public get pendingEventId(): number | null {
    this.syncOwner()
    return this.executor.pendingEventId
  }

  public settlePendingTarget() {
    this.syncOwner()
    return this.executor.settlePending()
  }

  private syncOwner(): void {
    const owner = (globalThis as any).$gameSystem
    if (owner === this.contextOwner) return
    this.contextOwner = owner
    this.visitedKeys.clear()
    this.npcInteractionCooldowns.clear()
    this.unreachableEvents.clear()
    this.lastKnownLockLevels.clear()
    this.lastLockBonusTargets.clear()
    this.executor.reset()
  }

  public setMap(mapId: number): void {
    this.syncOwner()
    if (this.currentMapId !== mapId) {
      this.currentMapId = mapId
      this.lastLockBonusTargets.clear()
    }
  }

  public markVisited(mapId: number, eventId: number, page?: number): void {
    const g = globalThis as any
    const event = g.$gameMap?.event?.(eventId)
    const pageIndex = page ?? (typeof event?._pageIndex === 'number' ? event._pageIndex : 0)
    this.visitedKeys.add(`${mapId}:${eventId}`)
    this.visitedKeys.add(`${mapId}:${eventId}:${pageIndex}`)
  }

  public recordFailure(
    eventId: number,
    mapId = this.currentMapId ?? (globalThis as any).$gameMap?.mapId?.() ?? 0,
    reason = 'no_effect',
    detail = 'No expected progress was observed',
    condition: StoryRetryCondition = {}
  ): void {
    const event = (globalThis as any).$gameMap?.event?.(eventId)
    const benchmark = isBenchmarkStoryGame()
    const requiredLevel = benchmark ? (StoryContextStore.getLockPrerequisite(mapId, eventId)?.requiredLevel ?? detectStaticLockRequirement(event) ?? undefined) : undefined
    StoryFailureMemory.record(mapId, eventId, reason, detail, { requiredLevel, requiresLockpick: benchmark && interactionKind(event) === 'chest', ...condition })
  }

  public isBlacklisted(eventId: number): boolean {
    this.syncOwner()
    const mapId = this.currentMapId ?? (globalThis as any).$gameMap?.mapId?.() ?? 0
    if (StoryFailureMemory.blocked(mapId, eventId)) return true
    if (!this.loopDetector.isSuppressed(eventId)) return false
    if (StoryFailureMemory.history(mapId, eventId).length) {
      this.loopDetector.release(eventId)
      return false
    }
    this.recordFailure(eventId, mapId, 'cycle', 'Repeated target cycle without meaningful progress')
    return true
  }

  public recordUnreachable(mapId: number, eventId: number): void {
    this.unreachableEvents.add(`${mapId}:${eventId}`)
    StoryContextStore.recordUnreachable(mapId, eventId)
  }

  public isUnreachable(mapId: number, eventId: number): boolean {
    return this.unreachableEvents.has(`${mapId}:${eventId}`) || StoryContextStore.isUnreachable(mapId, eventId)
  }

  public clearUnreachable(mapId?: number): void {
    if (typeof mapId === 'number') {
      for (const k of this.unreachableEvents) {
        if (k.startsWith(`${mapId}:`)) this.unreachableEvents.delete(k)
      }
    } else {
      this.unreachableEvents.clear()
    }
    StoryContextStore.clearUnreachable(mapId)
  }

  public recordInteraction(mapId: number, eventId: number, kind: string): void {
    if (kind === 'npc') {
      this.npcInteractionCooldowns.set(`${mapId}:${eventId}`, Date.now())
    }
  }

  public isNpcOnCooldown(mapId: number, eventId: number): boolean {
    const last = this.npcInteractionCooldowns.get(`${mapId}:${eventId}`)
    return last ? Date.now() - last < 30_000 : false
  }

  public unmarkVisited(mapId: number, eventId: number): void {
    this.visitedKeys.delete(`${mapId}:${eventId}`)
  }

  /**
   * Domain-specific guide step for the benchmark game (Heroines of Swords & Spells II).
   * Returns a prioritized target when on a known story map.
   */
  public getBenchmarkGuideTarget(mapId: number, playerPos: { x: number; y: number }, playerGuidance?: string | null): ExplorationTarget | null {
    return benchmarkStoryGuide(
      mapId,
      playerPos,
      positiveStoryGuidance(playerGuidance),
      (eventId) => this.isBlacklisted(eventId),
      (eventId) => this.visitedKeys.has(`${mapId}:${eventId}`)
    )
  }

  /**
   * General topological scanner for arbitrary RPG Maker maps.
   */
  public findNextTarget(mapId: number, playerPos: { x: number; y: number }, playerGuidance?: string | null): ExplorationTarget | null {
    const branches = this.findCandidateBranches(mapId, playerPos, playerGuidance)
    this.routes = []
    if (isBenchmarkStoryGame()) {
      const engine = globalThis as any
      for (const failure of StoryFailureMemory.history(mapId)) {
        if (failure.condition.requiredLevel && StoryFailureMemory.blocked(mapId, failure.eventId)) {
          StoryContextStore.recordLockPrerequisite(mapId, failure.eventId, 'chest', failure.condition.requiredLevel)
        }
      }
      const goals = StoryContextStore.getAllLockPrerequisites(mapId)
        .filter((goal) => {
          const event = engine.$gameMap?.event?.(goal.eventId)
          return event && !event._erased && !isCompletedEvent(event, mapId, goal.eventId)
        })
        .map((goal) => {
          const event = engine.$gameMap.event(goal.eventId)
          return {
            requiredLevel: goal.requiredLevel,
            target: {
              eventId: goal.eventId,
              x: event._x,
              y: event._y,
              kind: goal.kind === 'trap' ? 'lever' : 'chest',
              name: `已记录目标 #${goal.eventId}`,
              priority: 100,
            } as ExplorationTarget,
          }
        })
      const training = branches.map((target) => ({
        target,
        requiredLevel: detectStaticLockRequirement(engine.$gameMap?.event?.(target.eventId)) ?? 0,
        expectedGain: storyExpectedLockGain(engine.$gameMap?.event?.(target.eventId)),
      }))
      this.routes = buildStoryRoutes(training, goals, engine.$gameVariables?.value?.(3) ?? 0, playerPos)
      const next = this.routes[0]?.steps[0]?.target
      if (next && !branches.some((target) => target.guided))
        return { ...next, hint: `先${next.hint || `处理事件 #${next.eventId}`}，提升技能后返回目标 #${this.routes[0].goalEventId}` }
    }
    return branches?.[0] ?? null
  }

  /**
   * Multi-branch candidate planning: returns sorted candidate routes.
   */
  public findCandidateBranches(mapId: number, playerPos: { x: number; y: number }, playerGuidance?: string | null): ExplorationTarget[] {
    if (playerGuidance !== undefined) this.setPlayerGuidance(playerGuidance)
    this.setMap(mapId)
    const g = globalThis as any
    const map = g.$gameMap
    if (!map || typeof map.events !== 'function') return []

    const liveState = readAgentGameState()
    const nearbyMap = new Map((liveState.nearbyEvents || []).map((e: any) => [e.id, e]))
    const allEvents = (map.events() || []) as any[]
    const candidates: ExplorationTarget[] = []

    const currentLockLevel = isBenchmarkStoryGame() ? (g.$gameVariables?.value?.(3) ?? 0) : 0
    const lastLevel = this.lastKnownLockLevels.get(mapId) ?? -1
    if (currentLockLevel > lastLevel) {
      const newlyEligible = StoryContextStore.getEligibleUnlockedTargets(mapId, currentLockLevel)
      for (const p of newlyEligible) {
        if (p.requiredLevel <= lastLevel) continue
        this.lastLockBonusTargets.add(p.eventId)
      }
    }
    this.lastKnownLockLevels.set(mapId, currentLockLevel)

    // 1. Benchmark / domain guide: evaluate candidate branches (e.g. all available offering chests)
    const guideTargets: ExplorationTarget[] = []
    if (isBenchmarkStoryGame() && mapId === 6 && g.$gameSwitches?.value?.(27)) {
      const v7 = g.$gameVariables?.value?.(7) ?? 0
      if (v7 < 4) {
        const offeringChests = [
          { id: 19, x: 28, y: 14, hint: '开启试炼宝箱 (28, 14) 获取拉维尔娜赐礼 1/4' },
          { id: 17, x: 18, y: 25, hint: '开启试炼宝箱 (18, 25) 获取拉维尔娜赐礼 2/4' },
          { id: 25, x: 30, y: 34, hint: '开启试炼宝箱 (30, 34) 获取拉维尔娜赐礼 3/4' },
          { id: 28, x: 2, y: 34, hint: '开启试炼宝箱 (2, 34) 获取拉维尔娜赐礼 4/4' },
        ]
        for (const c of offeringChests) {
          const ev = map.event?.(c.id)
          if (ev && !chestEventOpened(ev, mapId, c.id)) {
            guideTargets.push({
              eventId: c.id,
              x: c.x,
              y: c.y,
              kind: 'chest',
              name: `Offering Chest #${c.id}`,
              priority: 140,
              hint: `${c.hint} (当前已收集 ${v7}/4)`,
            })
          }
        }
        guideTargets.sort((a, b) => {
          const distA = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y)
          const distB = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y)
          return distA - distB
        })
      }
    }
    if (guideTargets.length === 0) {
      const singleGuide = this.getBenchmarkGuideTarget(mapId, playerPos, playerGuidance)
      if (singleGuide) guideTargets.push(singleGuide)
    }

    for (const guideTarget of guideTargets) {
      const guideEvent = map.event?.(guideTarget.eventId)
      if (guideEvent && isStoryMapExit(guideEvent, mapId)) guideTarget.kind = 'transfer'
      const approachId = storyApproachEvent(
        guideTarget.eventId,
        (eventId) => this.isEligible(mapId, eventId) && (eventId === guideTarget.eventId || !isStoryMapExit(map.event?.(eventId), mapId))
      )
      if (approachId === null) continue
      if (approachId !== guideTarget.eventId) {
        const blockerId = approachId
        const blockerEvent = map.event?.(blockerId)
        if (blockerEvent && this.isEligible(mapId, blockerId)) {
          const blockerNearby = nearbyMap.get(blockerId)
          if (blockerNearby?.routeStatus !== 'terrain_blocked') {
            candidates.push({
              eventId: blockerId,
              x: Number(blockerEvent._x),
              y: Number(blockerEvent._y),
              kind: blockerNearby?.kind === 'door' ? 'lever' : 'guide',
              name: blockerNearby?.name || `Waypoint #${blockerId}`,
              priority: 145,
              hint: `通过/解除阻挡主线目标的事件 #${blockerId}`,
              guided: true,
            })
          }
        }
      } else if (!this.isUnreachable(mapId, guideTarget.eventId)) {
        const pageIndex = typeof guideEvent._pageIndex === 'number' ? guideEvent._pageIndex : 0
        const pageVisitKey = `${mapId}:${guideTarget.eventId}:${pageIndex}`
        if (!this.visitedKeys.has(pageVisitKey) || guideTarget.kind === 'transfer') {
          candidates.push(guideTarget)
        }
      }
    }

    for (const event of allEvents) {
      if (!event || event._erased) continue
      const eventId = typeof event.eventId === 'function' ? event.eventId() : event._eventId
      if (!eventId || typeof eventId !== 'number') continue
      if (!this.isEligible(mapId, eventId) || candidates.some((candidate) => candidate.eventId === eventId)) continue

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

      const pageVisitKey = `${mapId}:${eventId}:${pageIndex}`
      const list = (typeof event.list === 'function' ? event.list() : []) || []
      const codes = list.map((c: any) => c?.code).filter((c: any) => typeof c === 'number' && c !== 0)
      if (codes.length === 0) continue

      const isTransfer = isStoryMapExit(event, mapId)

      const eventData = typeof event.event === 'function' ? event.event() : null
      const rawName = eventData?.name || ''
      if (isTransfer) {
        candidates.push({ eventId, x, y, kind: 'transfer', name: rawName || 'Portal', priority: 20, hint: '本层可处理目标完成后再评估跨地图路线' })
        continue
      }
      const trigger = event._trigger ?? 0
      const isChestName = /(сундук|chest|宝箱|箱子)/i.test(rawName)
      const hasLootCode = hasRewardCommand(event)
      const isChest = isChestName || hasLootCode

      // Priority 1: Unopened chest / loot
      if (isChest) {
        if (!isCompletedEvent(event, mapId, eventId)) {
          const isNewlyUnlocked = this.lastLockBonusTargets.has(eventId)
          const priority = isNewlyUnlocked ? 115 : 80
          const hint = isNewlyUnlocked ? `开锁等级达标，前往开启已记录的宝箱 (#${eventId})` : '开启未收集的宝箱'
          candidates.push({ eventId, x, y, kind: 'chest', name: rawName || 'Chest', priority, hint })
          continue
        }
      }

      // Priority 1b: Ground pickups / sparkles / item drops
      const isPickup =
        nearby?.kind === 'pickup' ||
        nearby?.interactionClass === 'reward' ||
        /(sparkle|звёзд|звезд|отмычк|flame|сияние|блеск|пузырь|闪光|光点|掉落)/i.test(rawName) ||
        (/!Flame|!Other/i.test(event._characterName || '') && (rawName || '').length > 0)
      if (isPickup) {
        if (!isCompletedEvent(event, mapId, eventId)) {
          candidates.push({ eventId, x, y, kind: 'chest', name: rawName || 'Pickup', priority: 82, hint: rawName ? `调查收集 ${rawName}` : '拾取地表发光物品' })
          continue
        }
      }

      // Priority 2: Lever / interactive switch (strictly actual lever/switch names or graphics)
      const isLever = /(рычаг|lever|switch|кнопка|机关|开关)/i.test(rawName) || /(lever|switch)/i.test(event._characterName || '')
      if (isLever) {
        if (!this.visitedKeys.has(pageVisitKey)) {
          candidates.push({ eventId, x, y, kind: 'lever', name: rawName || 'Lever', priority: 70, hint: '触发机关/拉杆' })
          continue
        }
      }

      // Priority 2b: Doors / traps / barriers
      const isDoorOrTrap =
        !isTransfer &&
        (nearby?.kind === 'door' || /(door|gate|ловушка|trap|барьер|barrier|дверь|ворота|门|暗门|栅栏|陷阱)/i.test(rawName) || /!Door/i.test(event._characterName || ''))
      if (isDoorOrTrap && (trigger === 0 || trigger === 1 || trigger === 2)) {
        if (!isCompletedEvent(event, mapId, eventId)) {
          const isNewlyUnlocked = this.lastLockBonusTargets.has(eventId)
          const priority = isNewlyUnlocked ? 110 : 75
          const hint = isNewlyUnlocked ? `技能等级达标，前往解除已记录的陷阱 (#${eventId})` : rawName ? `调查/解除 ${rawName}` : '调查门扉或机关陷阱'
          candidates.push({ eventId, x, y, kind: 'lever', name: rawName || 'Door/Trap', priority, hint })
          continue
        }
      }

      // Priority 3: Talkable NPC / story trigger
      const hasDialogue = codes.some((c: number) => c === 101 || c === 102)
      if (hasDialogue && (trigger === 0 || trigger === 1 || trigger === 2)) {
        if (!this.visitedKeys.has(pageVisitKey)) {
          if (!this.isNpcOnCooldown(mapId, eventId) || playerGuidance) {
            candidates.push({ eventId, x, y, kind: 'npc', name: rawName || 'NPC', priority: 50, hint: rawName ? `与 ${rawName} 对话` : '与 NPC 对话' })
            continue
          }
        }
      }

      // Priority 3b: Inspectable scene objects (Statues, altars, signs, readable items)
      const isInspectable =
        !isTransfer &&
        (nearby?.interactive === true || trigger === 0 || trigger === 1) &&
        (nearby?.interactionClass === 'inspectable' ||
          nearby?.interactionClass === 'description' ||
          /(статуя|алтарь|altar|statue|神坛|雕像|книга|book|надпись|плита|碑|告示|石碑)/i.test(rawName))
      if (isInspectable && !this.visitedKeys.has(pageVisitKey)) {
        candidates.push({ eventId, x, y, kind: 'other', name: rawName || 'Object', priority: 55, hint: rawName ? `调查 ${rawName}` : '调查场景设施' })
        continue
      }

      // Priority 3c: General interactive objects / containers (barrels, crates, skeletons, furniture)
      const hasGraphic = Boolean(event._characterName) || Boolean(event._tileId)
      const isInteractable = !isTransfer && (trigger === 0 || nearby?.interactive === true) && (hasGraphic || nearby?.interactive === true)
      if (isInteractable && !this.visitedKeys.has(pageVisitKey)) {
        candidates.push({ eventId, x, y, kind: 'other', name: rawName || 'Interactive Object', priority: 45, hint: rawName ? `调查 ${rawName}` : '调查场景物体' })
        continue
      }
    }

    // Prioritize visible & reachable nearby events so agent stays in the current chamber
    for (const candidate of candidates) {
      if (candidate.kind === 'transfer') continue
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

    // Sort with immediate proximity bonus: clickable objects right next to the player take precedence
    candidates.sort((a, b) => {
      if (!storyTravelPolicy(this.playerGuidance).explicitTravel && (a.kind === 'transfer') !== (b.kind === 'transfer')) return a.kind === 'transfer' ? 1 : -1
      const distA = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y)
      const distB = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y)
      const isPickupA = a.kind === 'chest' && (a.name?.includes('Pickup') || a.priority < 100)
      const isPickupB = b.kind === 'chest' && (b.name?.includes('Pickup') || b.priority < 100)
      const boostA = a.kind !== 'transfer' ? (distA <= 1 ? (isPickupA ? 85 : 55) : distA <= 2 ? (isPickupA ? 70 : 40) : distA <= 4 ? (isPickupA ? 45 : 20) : 0) : 0
      const boostB = b.kind !== 'transfer' ? (distB <= 1 ? (isPickupB ? 85 : 55) : distB <= 2 ? (isPickupB ? 70 : 40) : distB <= 4 ? (isPickupB ? 45 : 20) : 0) : 0
      const scoreA = a.priority + boostA
      const scoreB = b.priority + boostB
      if (scoreB !== scoreA) return scoreB - scoreA
      return distA - distB
    })

    return candidates
  }

  /**
   * Safety net for card stuck / deadlock when all ordinary exploration targets have been exhausted.
   * Searches for interactive scene objects or re-investigates triggers to provoke state changes.
   */
  public findFallbackTarget(mapId: number, playerPos: { x: number; y: number }): ExplorationTarget | null {
    const g = globalThis as any
    const map = g.$gameMap
    if (!map || typeof map.events !== 'function') return null
    const allEvents = (map.events() || []) as any[]
    const liveState = readAgentGameState()
    const nearbyMap = new Map((liveState.nearbyEvents || []).map((e: any) => [e.id, e]))

    const fallbacks: ExplorationTarget[] = []

    for (const event of allEvents) {
      if (!event || event._erased) continue
      const eventId = typeof event.eventId === 'function' ? event.eventId() : event._eventId
      if (!eventId || typeof eventId !== 'number' || !this.isEligible(mapId, eventId)) continue
      const nearby = nearbyMap.get(eventId)
      if (nearby && nearby.routeStatus === 'terrain_blocked') continue

      const list = (typeof event.list === 'function' ? event.list() : []) || []
      const codes = list.map((c: any) => c?.code).filter((c: any) => typeof c === 'number' && c !== 0)
      if (isStoryMapExit(event, mapId) || codes.length === 0) continue

      const rawName = (typeof event.event === 'function' ? event.event()?.name : null) || ''
      if (event._trigger === 0 || event._trigger === 1 || nearby?.interactive) {
        fallbacks.push({
          eventId,
          x: Number(event._x),
          y: Number(event._y),
          kind: 'other',
          name: rawName || `Interactive #${eventId}`,
          priority: 25,
          hint: rawName ? `卡关备选：重新调查 ${rawName} 尝试触发推进` : `调查场景设施 #${eventId}`,
        })
      }
    }

    fallbacks.sort((a, b) => {
      const distA = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y)
      const distB = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y)
      return distA - distB
    })
    return fallbacks[0] ?? null
  }

  /**
   * When standard topological scanning produces no candidates, invoke PuzzleSolver
   * to reason across dialogue, items, and map events to deduce the next objective.
   */
  public async resolvePuzzleTarget(
    mapId: number,
    playerPos: { x: number; y: number },
    recentDialogue: string[] = [],
    playerGuidance?: string | null,
    signal?: AbortSignal
  ): Promise<ExplorationTarget | null> {
    if (!this.puzzleSolver) return null
    if (playerGuidance !== undefined) this.setPlayerGuidance(playerGuidance)
    const candidates = this.findCandidateBranches(mapId, playerPos)
    const localTargets = candidates.filter((target) => target.kind !== 'transfer')
    const allowed = new Set((!storyTravelPolicy(this.playerGuidance).explicitTravel && localTargets.length ? localTargets : candidates).map((target) => target.eventId))
    return resolveStoryPuzzleTarget(
      this.puzzleSolver,
      (currentMapId, eventId) => allowed.has(eventId) && this.isEligible(currentMapId, eventId),
      mapId,
      playerPos,
      recentDialogue,
      this.playerGuidance,
      signal
    )
  }

  /**
   * Execute approach and interaction with the target.
   */
  public async executeTarget(target: ExplorationTarget, io: InteractIo, signal?: AbortSignal): Promise<ExplorationActionResult> {
    const map = (globalThis as any).$gameMap
    const mapId = map?.mapId?.() ?? 0
    if (!this.isEligible(mapId, target.eventId)) return { success: false, outcome: 'ineligible' }
    const event = map.event(target.eventId)
    if (
      isStoryMapExit(event, mapId) &&
      !storyTravelPolicy(this.playerGuidance).explicitTravel &&
      this.findCandidateBranches(mapId, { x: (globalThis as any).$gamePlayer?.x ?? 0, y: (globalThis as any).$gamePlayer?.y ?? 0 }).some(
        (candidate) => candidate.kind !== 'transfer'
      )
    ) {
      return { success: false, outcome: 'ineligible', detail: '本层仍有可处理目标，暂不跨地图' }
    }
    return this.executor.execute({ ...target, kind: isStoryMapExit(event, mapId) ? 'transfer' : (interactionKind(event) ?? target.kind) }, io, signal)
  }
}
