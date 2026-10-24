/**
 * Background natural-enhancement candidates (T5).
 * At most 4 constrained wording templates per evidence waterline; no retry / no rewrite of shown cues.
 */

import type { CompanionCandidate, ContextStamp, CueKind, FactView, MemoryEpisode } from '@/lib/game-agent/companion/types'
import type { RuntimeMessage } from '@/lib/game-agent/runtime'

export const CANDIDATE_MAX = 4
export const CANDIDATE_CACHE_MAX = 32
export const CANDIDATE_TTL_MS = 10 * 60_000
export const CANDIDATE_MAX_BYTES = 64 * 1024

export type CandidateWaterline = {
  memoryEpoch: number
  factsRevision: number
  encounterId: string | null
  character: string
  locale: string
}

export type CandidatePrepareInput = {
  stamp: ContextStamp
  character: string
  locale: string
  facts: FactView
  episodes: MemoryEpisode[]
  kinds?: CueKind[]
}

type CachedCandidate = CompanionCandidate & { waterlineKey: string; bytes: number }

const ALLOWED_SLOTS = ['enemyName', 'abilityName', 'partyName', 'outcome'] as const

function waterlineKey(line: CandidateWaterline): string {
  return [line.memoryEpoch, line.factsRevision, line.encounterId ?? '', line.character, line.locale].join('|')
}

function estimate(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

function slotValues(facts: FactView, episodes: MemoryEpisode[]): Record<(typeof ALLOWED_SLOTS)[number], string> {
  const enemy = facts.current.enemies.value?.[0]
  const party = facts.current.party.value?.[0]
  const ability = episodes[0]?.evidence.find((item) => item.ability?.name)?.ability?.name
  const outcome = episodes[0]?.kind === 'knockout' ? 'loss' : episodes[0]?.kind === 'battle_result' ? episodes[0].summary.slice(0, 24) : ''
  return {
    enemyName: enemy?.name || '',
    abilityName: ability || '',
    partyName: party?.name || '',
    outcome,
  }
}

/** Only confirmed slots may remain as {slot}; unknown tokens are rejected. */
export function sanitizeCandidateTemplate(template: string, slots: Record<string, string>): string | null {
  const text = template.trim().slice(0, 180)
  if (!text) return null
  const tokens = [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1]!)
  for (const token of tokens) {
    if (!ALLOWED_SLOTS.includes(token as (typeof ALLOWED_SLOTS)[number])) return null
    if (!slots[token]) return null
  }
  return text
}

export function renderCandidateTemplate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_all, key: string) => slots[key] || '')
}

export function parseCandidatePayload(content: string, input: CandidatePrepareInput): CompanionCandidate[] {
  const slots = slotValues(input.facts, input.episodes)
  let parsed: unknown
  try {
    parsed = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    )
  } catch {
    return []
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { candidates?: unknown }).candidates)
      ? (parsed as { candidates: unknown[] }).candidates
      : []

  const out: CompanionCandidate[] = []
  for (const row of rows.slice(0, CANDIDATE_MAX)) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const kind = typeof item.kind === 'string' ? (item.kind as CueKind) : 'general'
    const template = typeof item.textTemplate === 'string' ? sanitizeCandidateTemplate(item.textTemplate, slots) : null
    if (!template) continue
    const evidenceRefs = Array.isArray(item.evidenceRefs)
      ? item.evidenceRefs.filter((ref): ref is string => typeof ref === 'string').slice(0, 4)
      : input.episodes.slice(0, 2).map((episode) => episode.episodeId)
    // Evidence must stay within provided episodes.
    if (evidenceRefs.some((ref) => !input.episodes.some((episode) => episode.episodeId === ref) && !ref.startsWith('fact:'))) {
      continue
    }
    out.push({
      candidateId: typeof item.candidateId === 'string' ? item.candidateId.slice(0, 80) : `cand-${out.length + 1}`,
      character: input.character,
      locale: input.locale,
      kind,
      textTemplate: template,
      evidenceRefs,
      stamp: input.stamp,
      expiresAt: Date.now() + CANDIDATE_TTL_MS,
    })
  }
  return out
}

export function buildCandidateMessages(input: CandidatePrepareInput): RuntimeMessage[] {
  const slots = slotValues(input.facts, input.episodes)
  const kinds = (input.kinds ?? ['battle_start', 'battle_win', 'battle_loss', 'rematch']).join(',')
  return [
    {
      role: 'system',
      content: [
        'Generate at most 4 short companion wording candidates as JSON.',
        'Return {"candidates":[{"kind":string,"textTemplate":string,"evidenceRefs":string[]}]} only.',
        'textTemplate may use only these placeholders when values are known: {enemyName} {abilityName} {partyName} {outcome}.',
        'Do not invent numbers, skills, mechanics, or claim disarm/guard will work.',
        'evidenceRefs must cite provided episode ids only.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        kinds,
        slots,
        episodes: input.episodes.slice(0, 3).map((episode) => ({
          episodeId: episode.episodeId,
          kind: episode.kind,
          summary: episode.summary.slice(0, 160),
          completeness: episode.completeness,
        })),
        scene: input.facts.current.scene.value,
        encounterId: input.facts.current.encounterId.value,
      }),
    },
  ]
}

export class CompanionCandidateCache {
  private items: CachedCandidate[] = []
  private prepared = new Set<string>()
  private bytes = 0
  private preparing: string | null = null
  private prepareController: AbortController | null = null
  private prepareDone: Promise<void> = Promise.resolve()
  private resolvePrepare: (() => void) | null = null

  constructor(private readonly now: () => number = () => Date.now()) {}

  waterline(input: { stamp: ContextStamp; character: string; locale: string; memoryEpoch: number; encounterId?: string | null }): CandidateWaterline {
    return {
      memoryEpoch: input.memoryEpoch,
      factsRevision: input.stamp.factsRevision,
      encounterId: input.encounterId ?? null,
      character: input.character,
      locale: input.locale,
    }
  }

  alreadyPrepared(line: CandidateWaterline): boolean {
    return this.prepared.has(waterlineKey(line))
  }

  markPrepared(line: CandidateWaterline): void {
    this.prepared.add(waterlineKey(line))
  }

  isPreparing(): boolean {
    return this.preparing != null
  }

  beginPrepare(line: CandidateWaterline): AbortSignal | null {
    const key = waterlineKey(line)
    if (this.preparing || this.prepared.has(key)) return null
    this.preparing = key
    this.prepareController = new AbortController()
    this.prepareDone = new Promise((resolve) => {
      this.resolvePrepare = resolve
    })
    return this.prepareController.signal
  }

  trackPrepare(done: Promise<void>): void {
    void done.catch(() => undefined)
  }

  async waitPrepare(): Promise<void> {
    await this.prepareDone
  }

  abortPrepare(): void {
    const key = this.preparing
    const controller = this.prepareController
    if (controller && !controller.signal.aborted) controller.abort()
    if (key) this.finishPrepare(key)
  }

  private finishPrepare(key: string): void {
    if (this.preparing !== key) return
    this.preparing = null
    this.prepareController = null
    this.resolvePrepare?.()
    this.resolvePrepare = null
  }

  endPrepare(line: CandidateWaterline, candidates: CompanionCandidate[]): void {
    const key = waterlineKey(line)
    this.finishPrepare(key)
    this.markPrepared(line)
    for (const candidate of candidates.slice(0, CANDIDATE_MAX)) {
      const cached: CachedCandidate = { ...candidate, waterlineKey: key, bytes: estimate(candidate) }
      this.items.push(cached)
      this.bytes += cached.bytes
    }
    this.prune()
  }

  failPrepare(line: CandidateWaterline): void {
    this.finishPrepare(waterlineKey(line))
    this.markPrepared(line)
  }

  clear(): void {
    this.abortPrepare()
    this.items = []
    this.prepared.clear()
    this.bytes = 0
    this.preparing = null
    this.prepareController = null
    this.resolvePrepare?.()
    this.resolvePrepare = null
    this.prepareDone = Promise.resolve()
  }

  invalidateStamp(stamp: ContextStamp): void {
    this.items = this.items.filter((item) => {
      const keep = item.stamp.contextEpoch === stamp.contextEpoch && item.stamp.scope.segmentId === stamp.scope.segmentId && item.expiresAt > this.now()
      if (!keep) this.bytes -= item.bytes
      return keep
    })
  }

  take(kind: CueKind, stamp: ContextStamp, character: string, locale: string): CompanionCandidate | null {
    this.prune()
    const index = this.items.findIndex(
      (item) =>
        item.kind === kind &&
        item.character === character &&
        item.locale === locale &&
        item.stamp.contextEpoch === stamp.contextEpoch &&
        item.stamp.factsRevision === stamp.factsRevision &&
        item.expiresAt > this.now()
    )
    if (index < 0) return null
    const [item] = this.items.splice(index, 1)
    if (!item) return null
    this.bytes -= item.bytes
    return item
  }

  private prune(): void {
    const now = this.now()
    this.items = this.items.filter((item) => {
      if (item.expiresAt > now) return true
      this.bytes -= item.bytes
      return false
    })
    while (this.items.length > CANDIDATE_CACHE_MAX || this.bytes > CANDIDATE_MAX_BYTES) {
      const removed = this.items.shift()
      if (!removed) break
      this.bytes -= removed.bytes
    }
  }
}

export const PREPARE_FORMAT = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          textTemplate: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'textTemplate'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const
