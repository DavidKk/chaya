/** Reduce MemoryInput / domain events into bounded episode + save-link effects. */

import { clampText, estimateRecordBytes, MEMORY_MILESTONE_DETAILS_MAX_BYTES, MEMORY_STRING_FIELD_MAX } from './memory-limits'
import { type MemoryEpisodeRecord, type MemorySaveLink, sameMemoryScope } from './memory-types'
import type {
  ActionEvidence,
  ActionGameEvent,
  BattleResultGameEvent,
  CompanionDomainEvent,
  KnockoutGameEvent,
  LoadGameEvent,
  MemoryInput,
  MilestoneGameEvent,
  SaveGameEvent,
} from './types'

export type MemoryIngestEffect = { type: 'episode'; episode: MemoryEpisodeRecord } | { type: 'saveLink'; link: MemorySaveLink } | { type: 'ignore'; reason: string }

export type ActionRingItem = {
  actionId: string
  resultId: string
  evidence: ActionEvidence
  encounterId?: string
  at: number
  sourceEventId: string
  bytes: number
  scope: MemoryInput['stamp']['scope']
  segmentId: string
  contextEpoch: number
}

function sourceEventId(input: MemoryInput): string {
  return input.source.eventId || `${input.source.producer.id}:${input.source.producer.epoch}:${input.source.producer.sourceSeq}`
}

function actionEvidence(event: ActionGameEvent): ActionEvidence {
  return {
    actionId: event.actionId,
    resultId: event.resultId,
    source: event.source,
    target: event.target,
    ability: event.ability,
    hpBefore: event.hpBefore,
    hpAfter: event.hpAfter,
    reportedHpDamage: event.reportedHpDamage,
    hpMax: event.hpMax,
    stateIdsBefore: event.stateIdsBefore,
    stateIdsAfter: event.stateIdsAfter,
    attribution: event.attribution,
  }
}

function episodeBase(
  input: MemoryInput,
  partial: Omit<MemoryEpisodeRecord, 'scope' | 'memoryEpoch' | 'persistence' | 'sourceEventIds' | 'stableKey' | 'bytes'>
): MemoryEpisodeRecord {
  const sourceId = sourceEventId(input)
  const episode: MemoryEpisodeRecord = {
    ...partial,
    scope: input.stamp.scope,
    memoryEpoch: input.memoryEpoch,
    persistence: 'pending',
    sourceEventIds: [sourceId],
    stableKey: sourceId,
  }
  episode.bytes = estimateRecordBytes(episode)
  return episode
}

function summarizeKnockout(event: KnockoutGameEvent): string {
  const killer = event.killer?.instance || (event.killer?.kind === 'unknown' ? '未知来源' : '敌人')
  const skill = event.lethalAbility?.name
  const target = event.target.instance || '队员'
  return skill ? `${killer}使用【${skill}】击倒了${target}` : `${killer}击倒了${target}`
}

function summarizeBattle(event: BattleResultGameEvent): string {
  if (event.outcome === 'win') return '战斗胜利'
  if (event.outcome === 'lose') return '战斗失败'
  if (event.outcome === 'escape') return '成功逃跑'
  return '战斗中断'
}

function sameTarget(a: ActionEvidence['target'] | KnockoutGameEvent['target'], b: KnockoutGameEvent['target']): boolean {
  return a.kind === b.kind && a.id === b.id && a.instance === b.instance
}

function observedKnockoutClaim(observed: ActionEvidence[], event: KnockoutGameEvent): boolean {
  return observed.some(
    (item) => sameTarget(item.target, event.target) && item.attribution === 'observed_action' && typeof item.hpBefore === 'number' && item.hpBefore > 0 && item.hpAfter === 0
  )
}

function actionsForInput(input: MemoryInput, recentActions: ActionRingItem[]): ActionRingItem[] {
  const scope = input.stamp.scope
  const encounterId = input.domainEvent && 'encounterId' in input.domainEvent ? input.domainEvent.encounterId : undefined
  return recentActions.filter((item) => {
    if (!sameMemoryScope(item.scope, scope) || item.segmentId !== scope.segmentId || item.contextEpoch !== input.stamp.contextEpoch) return false
    if (encounterId && item.encounterId && item.encounterId !== encounterId) return false
    return true
  })
}

function boundedMilestoneDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details).slice(0, 16)) {
    if (typeof value === 'string') next[clampText(key, 40)] = clampText(value, MEMORY_STRING_FIELD_MAX)
    else if (typeof value === 'number' && Number.isFinite(value)) next[clampText(key, 40)] = value
    else if (typeof value === 'boolean' || value == null) next[clampText(key, 40)] = value
    else if (Array.isArray(value)) next[clampText(key, 40)] = value.slice(0, 16)
    else if (value && typeof value === 'object') next[clampText(key, 40)] = value
  }
  while (estimateRecordBytes(next) > MEMORY_MILESTONE_DETAILS_MAX_BYTES && Object.keys(next).length) {
    delete next[Object.keys(next).at(-1)!]
  }
  return Object.keys(next).length ? next : undefined
}

function summarizeMilestone(event: MilestoneGameEvent, details?: Record<string, unknown>): string {
  if (event.name === 'level_up') {
    const actorId = typeof details?.actorId === 'number' ? details.actorId : undefined
    const fromLevel = typeof details?.fromLevel === 'number' ? details.fromLevel : undefined
    const toLevel = typeof details?.toLevel === 'number' ? details.toLevel : undefined
    if (actorId != null && fromLevel != null && toLevel != null) return `角色 ${actorId} 升级 ${fromLevel}→${toLevel}`
    if (toLevel != null) return `角色升级到 ${toLevel}`
    return '角色升级'
  }
  if (event.name === 'battle_reward') {
    const gold = typeof details?.gold === 'number' ? details.gold : 0
    const items = Array.isArray(details?.items) ? details.items.length : 0
    const levels = Array.isArray(details?.levels) ? details.levels.length : 0
    return `战斗奖励 金币${gold} 物品${items} 升级${levels}`
  }
  return event.name
}

export function reduceMemoryInput(input: MemoryInput, recentActions: ActionRingItem[] = []): MemoryIngestEffect[] {
  const event = input.domainEvent
  if (!event) return [{ type: 'ignore', reason: 'missing_domain_event' }]
  if (input.memoryEpoch < 1) return [{ type: 'ignore', reason: 'invalid_epoch' }]

  switch (event.kind) {
    case 'action':
      return [{ type: 'ignore', reason: 'action_buffered' }]
    case 'knockout': {
      const related = actionsForInput(input, recentActions)
        .filter((item) => sameTarget(item.evidence.target, event.target) || item.actionId === event.lethalActionId)
        .slice(-8)
      const observed = related.map((item) => item.evidence)
      const evidence =
        observed.length > 0
          ? observed
          : event.lethalActionId
            ? [
                {
                  actionId: event.lethalActionId,
                  resultId: `${event.lethalActionId}:lethal`,
                  source: event.killer || { kind: 'unknown' as const },
                  target: event.target,
                  ability: event.lethalAbility,
                  hpBefore: null,
                  hpAfter: 0,
                  reportedHpDamage: null,
                  attribution: 'unknown' as const,
                },
              ]
            : []
      return [
        {
          type: 'episode',
          episode: episodeBase(input, {
            episodeId: `ko:${sourceEventId(input)}`,
            encounterId: event.encounterId,
            at: event.at,
            kind: 'knockout',
            // Synthetic lethal stubs are not enough to claim a complete kill explanation.
            completeness: observedKnockoutClaim(observed, event) ? 'complete_for_claim' : 'partial',
            summary: summarizeKnockout(event),
            evidence,
          }),
        },
      ]
    }
    case 'battle_result':
      return [
        {
          type: 'episode',
          episode: episodeBase(input, {
            episodeId: `battle:${sourceEventId(input)}`,
            encounterId: event.encounterId,
            at: event.at,
            kind: 'battle_result',
            completeness: 'complete_for_claim',
            summary: summarizeBattle(event),
            evidence: actionsForInput(input, recentActions)
              .slice(-4)
              .map((item) => item.evidence),
            outcome: event.outcome,
          }),
        },
      ]
    case 'save': {
      if (event.phase !== 'commit') return [{ type: 'ignore', reason: 'save_not_committed' }]
      return [
        {
          type: 'episode',
          episode: episodeBase(input, {
            episodeId: `save:${sourceEventId(input)}`,
            at: event.at,
            kind: 'save',
            completeness: 'complete_for_claim',
            summary: `保存进度 (${event.saveKind})`,
            evidence: [],
          }),
        },
      ]
    }
    case 'load': {
      if (event.phase !== 'commit' || !event.toSegmentId) return [{ type: 'ignore', reason: 'load_not_committed' }]
      const link: MemorySaveLink = {
        id: `load:${event.operationId}`,
        scope: {
          libraryGameId: input.stamp.scope.libraryGameId,
          dataRevision: input.stamp.scope.dataRevision,
          playthroughId: input.stamp.scope.playthroughId,
        },
        origin: event.saveKind === 'unknown' ? 'unknown' : event.saveKind,
        slot: event.saveSlot,
        fromSegmentId: event.fromSegmentId,
        toSegmentId: event.toSegmentId,
        fromScope: event.fromScope
          ? {
              libraryGameId: event.fromScope.libraryGameId,
              dataRevision: event.fromScope.dataRevision,
              playthroughId: event.fromScope.playthroughId,
            }
          : undefined,
        at: event.at,
        memoryEpoch: input.memoryEpoch,
      }
      return [
        {
          type: 'saveLink',
          link,
        },
        {
          type: 'episode',
          episode: episodeBase(input, {
            episodeId: `load:${sourceEventId(input)}`,
            at: event.at,
            kind: 'load',
            completeness: 'complete_for_claim',
            summary: `读档 (${event.saveKind})`,
            evidence: [],
            linkedFrom: { segmentId: event.fromSegmentId, saveLinkId: link.id },
          }),
        },
      ]
    }
    case 'milestone': {
      const details = boundedMilestoneDetails(event.details)
      return [
        {
          type: 'episode',
          episode: episodeBase(input, {
            episodeId: `ms:${sourceEventId(input)}`,
            at: event.at,
            kind: 'milestone',
            completeness: 'complete_for_claim',
            summary: summarizeMilestone(event, details),
            evidence: [],
            details,
          }),
        },
      ]
    }
    case 'admin':
      return [{ type: 'ignore', reason: 'admin_handled_separately' }]
    default:
      return [{ type: 'ignore', reason: 'unsupported_event' }]
  }
}

export function toActionRingItem(input: MemoryInput, event: ActionGameEvent): ActionRingItem {
  const evidence = actionEvidence(event)
  const item: ActionRingItem = {
    actionId: event.actionId,
    resultId: event.resultId,
    evidence,
    encounterId: event.encounterId,
    at: event.at,
    sourceEventId: sourceEventId(input),
    bytes: estimateRecordBytes(evidence),
    scope: input.stamp.scope,
    segmentId: input.stamp.scope.segmentId,
    contextEpoch: input.stamp.contextEpoch,
  }
  return item
}

export function isActionDomainEvent(event: CompanionDomainEvent | undefined): event is ActionGameEvent {
  return event?.kind === 'action'
}

export function isSaveDomainEvent(event: CompanionDomainEvent | undefined): event is SaveGameEvent {
  return event?.kind === 'save'
}

export function isLoadDomainEvent(event: CompanionDomainEvent | undefined): event is LoadGameEvent {
  return event?.kind === 'load'
}

export function isMilestoneDomainEvent(event: CompanionDomainEvent | undefined): event is MilestoneGameEvent {
  return event?.kind === 'milestone'
}
