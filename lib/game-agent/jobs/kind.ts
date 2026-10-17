import { effectiveInteractionKind } from '@/lib/game-agent/interaction-target'

export type EventKind = 'npc' | 'door' | 'exit' | 'pickup' | 'object' | 'unknown'

const KINDS = new Set<EventKind>(['npc', 'door', 'exit', 'pickup', 'object', 'unknown'])

type Loose = Record<string, unknown>

function isObject(value: unknown): value is Loose {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Host-side kind used by plan and reconcile. Maps legacy `transit` label to `exit`. */
export function normalizeEventKind(event: unknown, state?: unknown): EventKind {
  const source = isObject(event) ? event : {}
  const raw = effectiveInteractionKind(source, isObject(state) ? state : undefined)
  if (raw === 'transit') return 'exit'
  if (source.interactionClass === 'transit' || source.transit === true) return 'exit'
  if (source.interactionClass === 'reward') return 'pickup'
  return KINDS.has(raw as EventKind) ? (raw as EventKind) : 'unknown'
}

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && KINDS.has(value as EventKind)
}
