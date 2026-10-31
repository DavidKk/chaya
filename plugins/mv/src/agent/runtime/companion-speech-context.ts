import type { MemoryEpisodeRecord } from '@/lib/game-agent/companion/memory-types'
import type { SpeechBattleOutcome, SpeechMemoryOrigin } from '@/lib/game-agent/companion/speech-lines'
import type { CompanionDomainEvent, FactView, MemoryEpisode } from '@/lib/game-agent/companion/types'
import type { CompanionMemoryResult } from '@/lib/runtime/companion-protocol'

function nearbyUnopenedChest(details: Record<string, unknown> | undefined): boolean {
  if (!details) return false
  // Explicit nearby + unopened flags only; battle_reward / level_up must not qualify.
  const nearby = details.nearby === true || details.nearby === 'true'
  if (nearby) {
    if (details.unopened === true || details.unopened === 'true') return true
    if (details.opened === false || details.opened === 'false') return true
    if (details.opened === true || details.opened === 'true' || details.unopened === false || details.unopened === 'false') return false
  }
  const events = details.nearbyEvents ?? details.chests ?? details.nearbyChests
  if (!Array.isArray(events)) return false
  return events.some((item) => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    if (row.opened === true || row.opened === 'true') return false
    const unopened = row.unopened === true || row.unopened === 'true' || row.opened === false || row.opened === 'false' || row.opened == null
    const distance = typeof row.distance === 'number' ? row.distance : Number(row.distance)
    const near = !Number.isFinite(distance) || distance <= 6
    return near && unopened
  })
}

export type DomainCueKind = 'battle_win' | 'battle_loss' | 'danger' | 'chest' | 'battle_start'

export function eventKindFromDomain(domain: CompanionDomainEvent | null, view: FactView): DomainCueKind | null {
  if (domain?.kind === 'battle_result') {
    if (domain.outcome === 'win') return 'battle_win'
    if (domain.outcome === 'lose') return 'battle_loss'
    return null
  }
  if (domain?.kind === 'knockout' && domain.target.kind === 'actor') return 'danger'
  // battle_reward / level_up are claimed rewards — never treat as an unopened nearby chest.
  if (domain?.kind === 'milestone') {
    const name = domain.name || ''
    if (/battle_reward|level_up/i.test(name)) return null
    if (/^chest$/i.test(name) || name === 'nearby_chest' || name === 'unopened_chest') {
      if (nearbyUnopenedChest(domain.details)) return 'chest'
    }
    return null
  }
  const party = view.current.party.value ?? []
  if (party.some((member) => !member.isDead && member.hpMax > 0 && member.hp / member.hpMax <= 0.35)) return 'danger'
  if (view.current.scene.value === 'battle' && view.current.encounterId.value) return 'battle_start'
  return null
}

const LEGACY_EPISODE_KINDS = new Set(['knockout', 'battle_result', 'defense_attempt'])

function isLegacyEpisodeKind(kind: string): kind is MemoryEpisode['kind'] {
  return LEGACY_EPISODE_KINDS.has(kind)
}

type SpeechEpisodeExtra = MemoryEpisodeRecord & { origin?: string; outcome?: SpeechBattleOutcome }

export function toSpeechEpisodes(records: MemoryEpisodeRecord[]): MemoryEpisode[] {
  const out: MemoryEpisode[] = []
  for (const episode of records) {
    if (!isLegacyEpisodeKind(episode.kind)) continue
    const extra = episode as SpeechEpisodeExtra
    out.push({
      episodeId: episode.episodeId,
      scope: episode.scope,
      encounterId: episode.encounterId,
      at: episode.at,
      kind: episode.kind,
      completeness: episode.completeness,
      summary: episode.summary,
      evidence: episode.evidence,
      memoryEpoch: episode.memoryEpoch,
      ...(episode.linkedFrom ? { linkedFrom: episode.linkedFrom } : {}),
      ...(extra.origin ? { origin: extra.origin } : {}),
      ...(extra.outcome ? { outcome: extra.outcome } : {}),
    } as MemoryEpisode)
  }
  return out
}

export function mapMemoryEpisodes(detailed: { scope: CompanionMemoryResult['scope']; memoryEpoch: number; episodes: MemoryEpisodeRecord[] }): CompanionMemoryResult {
  return {
    scope: detailed.scope,
    memoryEpoch: detailed.memoryEpoch,
    episodes: toSpeechEpisodes(detailed.episodes),
  }
}

export function memoryOriginOf(origin: string | undefined): SpeechMemoryOrigin | undefined {
  if (origin === 'linked_load_context') return 'linked_load_context'
  if (origin === 'current' || origin === 'current_playthrough') return 'current_playthrough'
  if (origin === 'unknown') return 'unknown'
  return undefined
}

export function battleOutcomeOf(kind: DomainCueKind | null, domain: CompanionDomainEvent | null): SpeechBattleOutcome | undefined {
  if (domain?.kind === 'battle_result') return domain.outcome
  if (kind === 'battle_win') return 'win'
  if (kind === 'battle_loss') return 'lose'
  return undefined
}
