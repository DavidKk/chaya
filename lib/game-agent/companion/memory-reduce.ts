/** Pure helpers for idempotent merge, scope isolation, and linked-load query. */

import { MEMORY_QUERY_DEFAULT_LIMIT, MEMORY_QUERY_MAX_LIMIT, MEMORY_QUERY_TEXT_BUDGET } from './memory-limits'
import { type MemoryEpisodeRecord, type MemoryQueryOptions, type MemoryQueryResult, type MemorySaveLink, sameMemoryScope } from './memory-types'
import type { MemoryEpisode, MemoryQueryFilter, RuntimeScope } from './types'

export function episodeStableKey(episode: Pick<MemoryEpisodeRecord, 'episodeId' | 'stableKey' | 'sourceEventIds'>): string {
  if (episode.stableKey) return episode.stableKey
  if (episode.sourceEventIds?.length) return episode.sourceEventIds.slice().sort().join('|')
  return episode.episodeId
}

export function mergeEpisodeIdempotent(existing: MemoryEpisodeRecord[], incoming: MemoryEpisodeRecord): { episodes: MemoryEpisodeRecord[]; changed: boolean; conflict?: boolean } {
  const key = episodeStableKey(incoming)
  const index = existing.findIndex((item) => episodeStableKey(item) === key)
  if (index < 0) return { episodes: [...existing, incoming], changed: true }
  const current = existing[index]!
  if (JSON.stringify({ ...current, persistence: undefined, bytes: undefined }) === JSON.stringify({ ...incoming, persistence: undefined, bytes: undefined })) {
    return { episodes: existing, changed: false }
  }
  // Same stable key, different content → isolate; do not overwrite facts.
  return { episodes: existing, changed: false, conflict: true }
}

export function filterEpisodes(episodes: MemoryEpisodeRecord[], scope: RuntimeScope, filter: MemoryQueryFilter & MemoryQueryOptions = {}): MemoryEpisodeRecord[] {
  const limit = Math.min(MEMORY_QUERY_MAX_LIMIT, Math.max(1, filter.limit ?? MEMORY_QUERY_DEFAULT_LIMIT))
  const matched = episodes.filter((ep) => {
    if (!sameMemoryScope(ep.scope, scope)) return false
    if (ep.memoryEpoch !== undefined && filter.intent !== 'explicit_history' && ep.persistence === 'pending' && filter.includePending === false) return false
    if (filter.segmentId && ep.scope.segmentId !== filter.segmentId) return false
    if (filter.encounterId && ep.encounterId !== filter.encounterId) return false
    if (filter.enemyIds?.length) {
      const hasEnemy = ep.evidence.some(
        (ev) =>
          (ev.source.kind === 'enemy' && ev.source.id != null && filter.enemyIds!.includes(ev.source.id)) || (ev.target.kind === 'enemy' && filter.enemyIds!.includes(ev.target.id))
      )
      if (!hasEnemy) return false
    }
    if (filter.skillIds?.length) {
      const hasSkill = ep.evidence.some((ev) => ev.ability?.kind === 'skill' && filter.skillIds!.includes(ev.ability.id))
      if (!hasSkill) return false
    }
    return true
  })
  return matched.sort((a, b) => b.at - a.at).slice(0, limit)
}

export function trimQueryText(episodes: MemoryEpisodeRecord[]): { episodes: MemoryEpisodeRecord[]; completeness: MemoryQueryResult['completeness'] } {
  let used = 0
  const kept: MemoryEpisodeRecord[] = []
  for (const episode of episodes) {
    const cost = episode.summary.length + episode.evidence.reduce((sum, item) => sum + (item.ability?.name?.length || 0) + 24, 0)
    if (kept.length && used + cost > MEMORY_QUERY_TEXT_BUDGET) {
      return { episodes: kept, completeness: 'partial' }
    }
    kept.push(episode)
    used += cost
  }
  return { episodes: kept, completeness: kept.every((item) => item.completeness === 'complete_for_claim') ? 'complete_for_claim' : kept.length ? 'partial' : 'unknown' }
}

/** recent_death may follow an explicit load.from edge; never merge playthrough stats. */
export function resolveLinkedLoadEpisodes(
  episodes: MemoryEpisodeRecord[],
  links: MemorySaveLink[],
  scope: RuntimeScope,
  options: MemoryQueryOptions
): { episodes: MemoryEpisodeRecord[]; origin?: MemoryQueryResult['origin']; linkedFrom?: MemoryQueryOptions['linkedFrom'] } {
  const candidates =
    options.intent === 'recent_death'
      ? episodes.filter(
          (episode) =>
            (episode.kind === 'battle_result' && episode.outcome === 'lose') ||
            (episode.kind === 'knockout' && episode.evidence.some((item) => item.target.kind === 'actor' && item.hpAfter === 0))
        )
      : episodes
  if (options.intent !== 'recent_death' && options.intent !== 'rematch' && !options.linkedFrom) {
    return { episodes: filterEpisodes(candidates, scope, options), origin: 'current' }
  }
  const current = filterEpisodes(candidates, scope, options)
  if (current.length) return { episodes: current, origin: 'current' }

  // rematch without enemy filter must not fall back to arbitrary recent deaths.
  if (options.intent === 'rematch' && !options.enemyIds?.length) {
    return { episodes: current, origin: current.length ? 'current' : undefined }
  }

  const linked = options.linkedFrom
  const persisted = links
    .filter((item) => item.scope.libraryGameId === scope.libraryGameId && item.scope.dataRevision === scope.dataRevision && item.toSegmentId === scope.segmentId)
    .sort((a, b) => b.at - a.at)[0]
  if (!linked && !persisted) return { episodes: current, origin: current.length ? 'current' : undefined, linkedFrom: options.linkedFrom }

  const fromSegmentId = persisted?.fromSegmentId || linked?.segmentId
  const fromEncounterId = persisted?.fromEncounterId || linked?.encounterId
  const fromEpisodeId = persisted?.fromEpisodeId || linked?.episodeId
  const fromScope = persisted?.fromScope || {
    libraryGameId: scope.libraryGameId,
    dataRevision: scope.dataRevision,
    playthroughId: scope.playthroughId,
  }
  // Unknown playthrough still queries via explicit fromScope labels; never merges stats.
  if (fromScope.libraryGameId !== scope.libraryGameId || fromScope.dataRevision !== scope.dataRevision) {
    return { episodes: current, origin: current.length ? 'current' : undefined, linkedFrom: options.linkedFrom }
  }
  const linkedScope: RuntimeScope = {
    ...scope,
    libraryGameId: fromScope.libraryGameId,
    dataRevision: fromScope.dataRevision,
    playthroughId: fromScope.playthroughId,
  }
  const linkedEpisodes = filterEpisodes(candidates, linkedScope, {
    ...options,
    segmentId: fromSegmentId,
    encounterId: fromEncounterId || options.encounterId,
    includePending: false,
  }).filter((item) => !fromEpisodeId || item.episodeId === fromEpisodeId)

  if (options.intent === 'rematch') {
    return {
      episodes: [...current, ...linkedEpisodes].slice(0, options.limit ?? MEMORY_QUERY_DEFAULT_LIMIT),
      origin: linkedEpisodes.length ? 'linked_load_context' : current.length ? 'current' : undefined,
      linkedFrom: {
        segmentId: fromSegmentId,
        encounterId: fromEncounterId,
        episodeId: fromEpisodeId,
      },
    }
  }
  return {
    episodes: linkedEpisodes.length ? linkedEpisodes : current,
    origin: linkedEpisodes.length ? 'linked_load_context' : current.length ? 'current' : undefined,
    linkedFrom: {
      segmentId: fromSegmentId,
      encounterId: fromEncounterId,
      episodeId: fromEpisodeId,
    },
  }
}

function isLegacyEpisodeKind(kind: MemoryEpisodeRecord['kind']): kind is MemoryEpisode['kind'] {
  return kind === 'knockout' || kind === 'battle_result' || kind === 'defense_attempt'
}

/** Legacy MemoryEpisode cannot express save/load/milestone; omit instead of faking battle_result. */
export function toLegacyEpisode(record: MemoryEpisodeRecord): MemoryEpisode | null {
  if (!isLegacyEpisodeKind(record.kind)) return null
  return {
    episodeId: record.episodeId,
    scope: record.scope,
    encounterId: record.encounterId,
    at: record.at,
    kind: record.kind,
    completeness: record.completeness,
    summary: record.summary,
    evidence: record.evidence,
    memoryEpoch: record.memoryEpoch,
    ...(record.kind === 'battle_result' && record.outcome ? { outcome: record.outcome } : {}),
  }
}

export function toLegacyEpisodes(records: MemoryEpisodeRecord[]): MemoryEpisode[] {
  const out: MemoryEpisode[] = []
  for (const record of records) {
    const legacy = toLegacyEpisode(record)
    if (legacy) out.push(legacy)
  }
  return out
}
