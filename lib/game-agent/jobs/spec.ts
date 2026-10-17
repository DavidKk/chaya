import { type EventKind, isEventKind } from './kind'
import type { InteractBatchSpec, VisibleBounds } from './types'

export type SpecParseResult =
  { ok: true; spec: InteractBatchSpec } | { ok: false; reason: 'invalid_json' | 'invalid_fields' | 'cardinality_one' | 'empty_after_filter'; detail?: string }

function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((id) => Number.isInteger(id) && id > 0)
}

function kinds(value: unknown): EventKind[] | null {
  if (!Array.isArray(value)) return null
  const list = value.filter(isEventKind)
  return list.length === value.length ? list : null
}

/** Parse model JSON into InteractBatchSpec. Does not apply world filters. */
export function parseInteractBatchSpec(content: string): SpecParseResult {
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'invalid_json' }
    raw = parsed as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (raw.kind !== 'interact_batch') return { ok: false, reason: 'invalid_fields', detail: 'kind' }
  if (raw.scope !== 'visible_map') return { ok: false, reason: 'invalid_fields', detail: 'scope' }
  if (raw.cardinality !== 'one' && raw.cardinality !== 'many') return { ok: false, reason: 'invalid_fields', detail: 'cardinality' }
  if (raw.onChoice !== 'ask_player' && raw.onChoice !== 'decide') return { ok: false, reason: 'invalid_fields', detail: 'onChoice' }
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) return { ok: false, reason: 'invalid_fields', detail: 'summary' }

  let includeKinds: EventKind[] | 'all'
  if (raw.includeKinds === 'all') includeKinds = 'all'
  else {
    const list = kinds(raw.includeKinds)
    if (!list?.length) return { ok: false, reason: 'invalid_fields', detail: 'includeKinds' }
    includeKinds = list
  }
  const excludeKinds = kinds(raw.excludeKinds)
  if (!excludeKinds) return { ok: false, reason: 'invalid_fields', detail: 'excludeKinds' }

  const spec: InteractBatchSpec = {
    kind: 'interact_batch',
    scope: 'visible_map',
    includeKinds,
    excludeKinds,
    includeEventIds: numbers(raw.includeEventIds),
    excludeEventIds: numbers(raw.excludeEventIds),
    cardinality: raw.cardinality,
    onChoice: raw.onChoice,
    summary: raw.summary.trim(),
  }
  if (spec.cardinality === 'one') return { ok: false, reason: 'cardinality_one' }
  return { ok: true, spec }
}

export function inVisibleBounds(x: number, y: number, bounds: VisibleBounds) {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY
}

/** Keep only ids present in the planning snapshot. */
export function sanitizeSpecIds(spec: InteractBatchSpec, knownIds: ReadonlySet<number>): InteractBatchSpec {
  return {
    ...spec,
    includeEventIds: spec.includeEventIds.filter((id) => knownIds.has(id)),
    excludeEventIds: spec.excludeEventIds.filter((id) => knownIds.has(id)),
  }
}

export function eventPassesSpec(
  event: { eventId: number; normalizedKind: EventKind; interactive: boolean; opened: boolean },
  spec: InteractBatchSpec
): 'execute' | 'deferred' | 'exclude' {
  if (!event.interactive || event.opened) return 'exclude'
  if (spec.excludeEventIds.includes(event.eventId) || spec.excludeKinds.includes(event.normalizedKind)) return 'exclude'
  if (spec.includeEventIds.length && !spec.includeEventIds.includes(event.eventId)) return 'exclude'
  if (event.normalizedKind === 'unknown') {
    if (spec.includeKinds !== 'all' && !spec.includeKinds.includes('unknown')) return 'exclude'
    return 'deferred'
  }
  if (spec.includeKinds !== 'all' && !spec.includeKinds.includes(event.normalizedKind)) return 'exclude'
  return 'execute'
}
