import { recordingFingerprint, validateBattleRecord } from './core/recording-schema'
import type { BattleRecordEvent, BattleRecordingSnapshot } from './core/recording-types'
import { projectHpExperiences, queryHpExperiences } from './experience'
import type { ExperienceQuery, ExperienceQueryResult, HpExperience } from './experience-types'
import { estimateRecordBytes, MEMORY_EVIDENCE_ARRAY_MAX, MEMORY_PENDING_QUEUE_MAX_BYTES } from './memory-limits'
import type { MemoryEpisodeRecord } from './memory-types'
import type { ActionEvidence, RuntimeScope } from './types'

const MAX_EVENTS = 512
const outcomes = { win: '战斗胜利', lose: '战斗失败', escape: '成功逃跑', abort: '战斗中止' }

function encounterKey(scope: RuntimeScope, encounterId?: string): string {
  return JSON.stringify([scope.libraryGameId, scope.dataRevision, scope.playthroughId, scope.runtimeInstanceId, scope.segmentId, encounterId])
}

function evidenceKey(evidence: ActionEvidence): string {
  return JSON.stringify([evidence.actionId, evidence.resultId, evidence.target.kind, evidence.target.id, evidence.target.instance])
}

function semanticKey(episode: MemoryEpisodeRecord): string | undefined {
  const key = encounterKey(episode.scope, episode.encounterId)
  if (episode.kind === 'battle_result' && episode.encounterId) return `${key}:result`
  const lethal = episode.kind === 'knockout' && [...episode.evidence].reverse().find((item) => item.hpBefore !== null && item.hpBefore > 0 && item.hpAfter === 0)
  if (lethal) return `${key}:knockout:${evidenceKey(lethal)}`
  return undefined
}

// IDs are compact reference labels. Grouping uses full identities, with collision rejection below.
function referenceId(identity: string): string {
  return (
    'recording:' +
    [2166136261, 2246822507, 3266489909, 668265263]
      .map((seed) => {
        let hash = seed
        for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619)
        return (hash >>> 0).toString(16).padStart(8, '0')
      })
      .join('')
  )
}

function mergeEvidence(first: ActionEvidence[], second: ActionEvidence[]): ActionEvidence[] {
  const entries = new Map(first.map((item) => [evidenceKey(item), item]))
  for (const item of second) if (!entries.has(evidenceKey(item))) entries.set(evidenceKey(item), item)
  return [...entries.values()].slice(-MEMORY_EVIDENCE_ARRAY_MAX)
}

function mergeEpisode(legacy: MemoryEpisodeRecord, projected: MemoryEpisodeRecord): MemoryEpisodeRecord {
  // Pending legacy details have no durable acknowledgement. Use the committed projection alone.
  if (legacy.persistence !== 'committed') return projected
  const conflict = legacy.outcome && projected.outcome && legacy.outcome !== projected.outcome
  const evidence = mergeEvidence(projected.evidence, legacy.evidence)
  const merged = {
    ...projected,
    episodeId: legacy.episodeId,
    stableKey: legacy.stableKey,
    linkedFrom: legacy.linkedFrom,
    at: Math.max(projected.at, legacy.at),
    evidence,
    outcome: conflict ? undefined : projected.outcome || legacy.outcome,
    summary: conflict ? '战斗结果记录存在冲突，结局未知' : projected.outcome ? projected.summary : legacy.outcome ? legacy.summary : projected.summary,
    completeness: conflict ? ('unknown' as const) : ('partial' as const),
    sourceEventIds: [...new Set([...(legacy.sourceEventIds || []), ...(projected.sourceEventIds || [])])].slice(-MEMORY_EVIDENCE_ARRAY_MAX),
  }
  return { ...merged, bytes: estimateRecordBytes(merged) }
}

/** Bounded read projection of acknowledged records. It never creates a second persisted event stream. */
export class BattleRecordingExperience {
  private events = new Map<string, { event: BattleRecordEvent; bytes: number; fingerprint: string }>()
  private bytes = 0
  private memoryEpoch = 1
  private detailsTrimmed = false
  private cached?: MemoryEpisodeRecord[]
  private cachedExperiences?: HpExperience[]

  replace(snapshot: BattleRecordingSnapshot | undefined, memoryEpoch: number): void {
    this.clear()
    this.memoryEpoch = memoryEpoch
    this.detailsTrimmed = snapshot?.detailsTrimmed === true
    this.append(snapshot?.recentEvents || [])
  }

  append(events: BattleRecordEvent[]): void {
    // Validate the entire batch before publishing any facts.
    const validated = events.map(validateBattleRecord)
    for (const event of validated) {
      const key = JSON.stringify([encounterKey(event.scope, event.encounterId), event.kind, event.eventId])
      const fingerprint = recordingFingerprint(event)
      const previous = this.events.get(key)
      if (previous) {
        if (previous.fingerprint !== fingerprint) this.detailsTrimmed = true
        continue
      }
      const bytes = estimateRecordBytes(event)
      this.events.set(key, { event, bytes, fingerprint })
      this.bytes += bytes
    }
    while (this.events.size > MAX_EVENTS || this.bytes > MEMORY_PENDING_QUEUE_MAX_BYTES) {
      const oldest = this.events.keys().next().value
      if (oldest === undefined) break
      this.bytes -= this.events.get(oldest)!.bytes
      this.events.delete(oldest)
      this.detailsTrimmed = true
    }
    this.cached = undefined
    this.cachedExperiences = undefined
  }

  clear(libraryGameId?: string, memoryEpoch = this.memoryEpoch): void {
    for (const [key, value] of this.events) {
      if (libraryGameId && value.event.scope.libraryGameId !== libraryGameId) continue
      this.bytes -= value.bytes
      this.events.delete(key)
    }
    if (!libraryGameId) this.detailsTrimmed = false
    this.memoryEpoch = memoryEpoch
    this.cached = undefined
    this.cachedExperiences = undefined
  }

  usedBytes(): number {
    return this.bytes
  }

  queryExperiences(scope: RuntimeScope, filter: ExperienceQuery = {}): ExperienceQueryResult {
    this.cachedExperiences ??= projectHpExperiences(
      [...this.events.values()].flatMap(({ event }) => (event.kind === 'action_result' && event.result.evidence ? [{ ...event, evidence: event.result.evidence }] : [])),
      this.memoryEpoch
    )
    return {
      projectionVersion: 1,
      memoryEpoch: this.memoryEpoch,
      coverage: 'retained_observations',
      detailsTrimmed: this.detailsTrimmed,
      experiences: queryHpExperiences(this.cachedExperiences, scope, filter),
    }
  }

  merge(legacy: MemoryEpisodeRecord[]): MemoryEpisodeRecord[] {
    const projected = new Map(this.project().map((episode) => [semanticKey(episode)!, episode]))
    const result: MemoryEpisodeRecord[] = []
    // Merge every overlapping legacy row into one experience, preserving a committed legacy ID.
    const overlaps = new Map<string, MemoryEpisodeRecord[]>()
    for (const episode of legacy) {
      const key = semanticKey(episode)
      if (!key || !projected.has(key)) {
        result.push(episode)
        continue
      }
      const rows = overlaps.get(key) || []
      rows.push(episode)
      overlaps.set(key, rows)
    }
    for (const [key, episode] of projected) {
      const rows = overlaps.get(key) || []
      let merged = rows.reduceRight((current, legacy) => mergeEpisode(legacy, current), episode)
      const known = new Set([episode, ...rows.filter((row) => row.persistence === 'committed')].flatMap((row) => (row.outcome ? [row.outcome] : [])))
      if (known.size > 1) {
        merged = { ...merged, outcome: undefined, summary: '战斗结果记录存在冲突，结局未知', completeness: 'unknown' }
        merged.bytes = estimateRecordBytes(merged)
      }
      result.push(merged)
    }
    return result
  }

  private project(): MemoryEpisodeRecord[] {
    if (this.cached) return this.cached
    const groups = new Map<string, BattleRecordEvent[]>()
    for (const { event } of this.events.values()) {
      const key = encounterKey(event.scope, event.encounterId)
      const group = groups.get(key) || []
      group.push(event)
      groups.set(key, group)
    }
    const episodes: MemoryEpisodeRecord[] = []
    const identities = new Map<string, string>()
    const collisions = new Set<string>()
    const add = (identity: string, episode: Omit<MemoryEpisodeRecord, 'episodeId' | 'bytes'>) => {
      const episodeId = referenceId(identity)
      if (identities.has(episodeId) && identities.get(episodeId) !== identity) collisions.add(episodeId)
      identities.set(episodeId, identity)
      episodes.push({ ...episode, episodeId, bytes: estimateRecordBytes(episode) })
    }
    for (const [key, events] of groups) {
      const { scope, encounterId } = events[0]
      const base = { scope, encounterId, memoryEpoch: this.memoryEpoch, persistence: 'committed' as const }
      const results = events.filter((event) => event.kind === 'action_result')
      for (const event of results) {
        const evidence = event.result.evidence
        if (!evidence || evidence.hpBefore === null || evidence.hpBefore <= 0 || evidence.hpAfter !== 0) continue
        add(`${key}:knockout:${evidenceKey(evidence)}`, {
          ...base,
          at: event.at,
          kind: 'knockout',
          completeness: evidence.attribution === 'observed_action' ? 'complete_for_claim' : 'partial',
          summary: `${evidence.target.kind === 'actor' ? '角色' : '敌人'} ${evidence.target.id} 的生命值降至 0`,
          evidence: [evidence],
          sourceEventIds: [event.eventId],
        })
      }
      const finishes = events.filter((event) => event.kind === 'encounter_finished')
      if (!finishes.length) continue
      const known = new Set(finishes.map((event) => event.outcome).filter((outcome) => outcome !== 'unknown'))
      const outcome = known.size === 1 ? [...known][0] : undefined
      const evidence = mergeEvidence(
        [],
        results.flatMap((event) => (event.result.evidence ? [event.result.evidence] : []))
      )
      // Even a complete start marker cannot prove no intermediate records were lost.
      const suffix = this.detailsTrimmed ? '（仅涵盖保留的观察记录，详情已裁剪）' : '（仅涵盖已记录的观察）'
      add(`${key}:result`, {
        ...base,
        at: Math.max(...finishes.map((event) => event.at)),
        kind: 'battle_result',
        outcome,
        summary: `${known.size > 1 ? '战斗结果记录存在冲突，结局未知' : outcome ? outcomes[outcome] : '战斗已结束，结局未知'}${suffix}`,
        completeness: outcome ? 'partial' : 'unknown',
        evidence,
        sourceEventIds: events.map((event) => event.eventId).slice(-MEMORY_EVIDENCE_ARRAY_MAX),
      })
    }
    this.cached = episodes.filter((episode) => !collisions.has(episode.episodeId))
    return this.cached
  }
}
