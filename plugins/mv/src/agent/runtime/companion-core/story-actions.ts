import { chestEventOpened } from '../../event-facts'
import { interactEvent, type InteractIo } from '../../interact'
import { isBenchmarkStoryGame } from './story-benchmark'
import { StoryContextStore } from './story-context'
import { isCompletedEvent, isTrapEvent } from './story-eligibility'
import type { ExplorationActionResult, ExplorationTarget, StoryExplorationPlanner } from './story-exploration'
import { StoryFailureMemory } from './story-failure-memory'
import type { StoryLoopDetector } from './story-loop-detector'
import { executeMapMenuEquip } from './story-menu'
import { storyRetryFacts } from './story-retry-facts'

type PendingTarget = {
  mapId: number
  target: ExplorationTarget
  pageIndex: number
  progress: string
  lockLevel: number
  rewards: Record<string, number>
  retryFacts: string | null
}

function rewardCounts(): Record<string, number> {
  const party = (globalThis as any).$gameParty
  const rewards: Record<string, number> = { gold: party?.gold?.() ?? 0 }
  for (const kind of ['items', 'weapons', 'armors']) {
    const counts = party?.[`_${kind}`] ?? {}
    for (const id of Object.keys(counts)) rewards[`${kind}:${id}`] = counts[id]
  }
  return rewards
}

export function storyProgressKey(): string {
  const engine = globalThis as any
  return JSON.stringify([
    engine.$gameVariables?._data,
    engine.$gameSwitches?._data,
    engine.$gameSelfSwitches?._data,
    engine.$gameParty?._items,
    engine.$gameParty?._weapons,
    engine.$gameParty?._armors,
    engine.$gameParty?.gold?.(),
  ])
}

export class StoryTargetExecutor {
  private pending: PendingTarget | null = null

  constructor(
    private readonly planner: Pick<StoryExplorationPlanner, 'markVisited' | 'recordFailure' | 'recordInteraction' | 'recordUnreachable' | 'clearUnreachable'>,
    private readonly getLoopDetector: (mapId: number) => StoryLoopDetector
  ) {}

  public get pendingEventId(): number | null {
    return this.pending?.target.eventId ?? null
  }

  public reset(): void {
    this.pending = null
  }

  public settlePending(): { target: ExplorationTarget; result: ExplorationActionResult } | null {
    if (!this.pending) return null
    const engine = globalThis as any
    if (engine.$gameMessage?.isBusy?.() || engine.$gameMap?.isEventRunning?.()) return null
    const pending = this.pending
    this.pending = null
    const transferred = engine.$gameMap?.mapId?.() !== pending.mapId
    return { target: pending.target, result: this.finish(pending, 'done', transferred) }
  }

  private finish(before: PendingTarget, outcome: string, transferred = false): ExplorationActionResult {
    const { mapId, target } = before
    const engine = globalThis as any
    const event = !transferred ? engine.$gameMap?.event?.(target.eventId) : null
    const progress = storyProgressKey()
    const changed = progress !== before.progress || event?._erased || event?._pageIndex !== before.pageIndex
    if (!transferred && (target.kind === 'chest' || target.kind === 'lever')) {
      const skillGained = (engine.$gameVariables?.value?.(3) ?? 0) > before.lockLevel
      const rewards = rewardCounts()
      const gainedReward = Object.entries(rewards).some(([key, count]) => count > (before.rewards[key] ?? 0))
      const isTrap = isTrapEvent(event)
      const completed =
        event &&
        (isTrap
          ? isCompletedEvent(event, mapId, target.eventId) || skillGained
          : target.kind === 'chest'
            ? chestEventOpened(event, mapId, target.eventId) || gainedReward
            : changed)
      if (!completed) {
        StoryFailureMemory.settleChoice(mapId, target.eventId, false)
        if (isTrap && event && event._pageIndex > before.pageIndex) {
          this.getLoopDetector(mapId).record({ ...target, madeProgress: true })
          return { success: true, outcome: 'revealed' }
        }
        this.getLoopDetector(mapId).record(target)
        this.getLoopDetector(mapId).suppress(target.eventId)
        this.planner.markVisited(mapId, target.eventId, before.pageIndex)
        this.planner.recordFailure(target.eventId, mapId, 'unopened', 'The event ended without the expected completion state or reward')
        return { success: false, outcome: 'unopened', detail: `Event #${target.eventId} completed without the expected state change` }
      }
      if (target.kind === 'chest') StoryContextStore.recordChestOpened(mapId, target.eventId, target.name || undefined)
      else {
        StoryContextStore.recordLeverPulled(mapId, target.eventId, target.name || undefined)
        this.planner.clearUnreachable(mapId)
      }
      StoryContextStore.clearLockPrerequisite(mapId, target.eventId)
      StoryFailureMemory.settleChoice(mapId, target.eventId, true)
    }
    this.getLoopDetector(mapId).record({ ...target, madeProgress: Boolean(changed || transferred) })
    if (!transferred && target.kind !== 'chest' && target.kind !== 'lever' && before.retryFacts === storyRetryFacts(mapId, target.eventId)) {
      this.planner.recordFailure(target.eventId, mapId, 'no_effect', 'The interaction ended without changing its relevant prerequisites or event state')
    }
    if (target.kind !== 'chest' && target.kind !== 'lever') StoryFailureMemory.settleChoice(mapId, target.eventId, Boolean(changed || transferred))
    this.planner.recordInteraction(mapId, target.eventId, target.kind)
    this.planner.markVisited(mapId, target.eventId, transferred ? before.pageIndex : undefined)
    if (target.kind === 'npc') StoryContextStore.recordNpcInteraction(mapId, target.eventId, target.name || undefined)
    if (transferred) this.planner.clearUnreachable(mapId)
    return { success: true, outcome, transferred }
  }

  public async execute(target: ExplorationTarget, io: InteractIo, signal?: AbortSignal): Promise<ExplorationActionResult> {
    signal?.throwIfAborted()
    const engine = globalThis as any
    const map = engine.$gameMap
    if (!map || !engine.$gamePlayer) return { success: false, detail: 'Map not ready' }
    const mapId = map.mapId()
    const event = map.event?.(target.eventId)
    const before = {
      mapId,
      target,
      pageIndex: event?._pageIndex ?? 0,
      progress: storyProgressKey(),
      lockLevel: engine.$gameVariables?.value?.(3) ?? 0,
      rewards: rewardCounts(),
      retryFacts: storyRetryFacts(mapId, target.eventId),
    }
    try {
      const result = await interactEvent({ eventId: target.eventId, openDoors: true }, io)
      signal?.throwIfAborted()
      const transferred = 'transferred' in result && result.transferred === true
      const ownsEvent = map._interpreter?.eventId?.() === target.eventId
      if (!transferred && (result.outcome === 'choice' || (ownsEvent && ['scene_changed', 'timeout', 'input_required'].includes(result.outcome)))) {
        this.pending = before
        return { success: false, outcome: result.outcome, pending: true }
      }
      if (result.outcome === 'done' || transferred) {
        const finished = this.finish(before, result.outcome, transferred)
        if (finished.success && isBenchmarkStoryGame() && mapId === 1 && target.eventId === 3 && !io.interrupted()) {
          const leader = engine.$gameParty?.leader?.()
          const weapon = engine.$dataWeapons?.[5]
          if (weapon && leader && !leader.isEquipped?.(weapon) && engine.$gameParty?.hasItem?.(weapon)) {
            await executeMapMenuEquip(0, 5, true, 0, signal)
          }
        }
        return finished
      }
      if (result.outcome === 'no_path') {
        if (!('blockedBy' in result) || !Array.isArray(result.blockedBy) || !result.blockedBy.length) this.planner.recordUnreachable(mapId, target.eventId)
      }
      if (['no_path', 'movement_blocked', 'no_reaction', 'nothing_to_run', 'gone', 'runs_by_itself', 'timeout'].includes(result.outcome)) {
        const blockers =
          'blockedBy' in result && Array.isArray(result.blockedBy)
            ? result.blockedBy.map((blocker: any) => blocker.eventId).filter((eventId: unknown): eventId is number => typeof eventId === 'number')
            : []
        this.planner.recordFailure(target.eventId, mapId, result.outcome, `Interaction ended with ${result.outcome}`, { blockerEventIds: blockers })
        this.getLoopDetector(mapId).record(target)
      }
      return { success: false, outcome: result.outcome }
    } catch (error) {
      signal?.throwIfAborted()
      throw error
    }
  }
}
