import type { CompanionModelMetrics, CompanionModelStatus } from '@/lib/game-agent/companion/model-diagnostics'
import type { CompanionError, ContextStamp, Cue, MemoryEpisode, MemoryQueryFilter, RuntimeScope } from '@/lib/game-agent/companion/types'

export const COMPANION_PROTOCOL_VERSION = 1
export const COMPANION_LOCAL_EVENT = 'chaya:companion-message'

export type CompanionSelection = {
  profileId: string
  model: string
  locale: string
  character: string
  thinking?: boolean
}

export type CompanionHostRequest =
  | { type: 'agent.companion.status'; requestId: string }
  | ({ type: 'agent.companion.route'; requestId: string; prompt: string; conversationId: string } & CompanionSelection)
  | ({ type: 'agent.companion.chat'; requestId: string; prompt: string; conversationId: string; stamp: ContextStamp } & CompanionSelection)
  | { type: 'agent.companion.cancel'; requestId: string; targetRequestId: string }
  | {
      type: 'agent.companion.events'
      requestId: string
      afterSeq: number
      consumerId: string
      visible: boolean
      locale: string
      character: string
      conversationId?: string
    }
  | { type: 'agent.companion.control.start'; requestId: string; ticketId: string }
  | { type: 'agent.memory.query'; requestId: string; filter?: MemoryQueryFilter }
  | {
      type: 'agent.memory.settings'
      requestId: string
      recording?: boolean
      naturalEnhancement?: boolean
      preferences?: { verbosity?: 'quiet' | 'normal' | 'chatty'; spoilers?: 'avoid' | 'allow'; muteUntil?: number }
    }
  | { type: 'agent.memory.clear'; requestId: string }

export const COMPANION_REQUEST_TYPES: ReadonlySet<string> = new Set<CompanionHostRequest['type']>([
  'agent.companion.status',
  'agent.companion.route',
  'agent.companion.chat',
  'agent.companion.cancel',
  'agent.companion.events',
  'agent.companion.control.start',
  'agent.memory.query',
  'agent.memory.settings',
  'agent.memory.clear',
])

export type CompanionMessageEvent = {
  seq: number
  at: number
  kind: 'cue' | 'accepted' | 'queued' | 'model.status' | 'delta' | 'completed' | 'cancelled' | 'failed' | 'context.changed'
  requestId?: string
  messageId: string
  conversationId?: string
  consumerId?: string
  stamp: ContextStamp
  text?: string
  thought?: string
  cue?: Cue
  error?: CompanionError
  metrics?: CompanionModelMetrics
  modelStatus?: CompanionModelStatus
}

export type CompanionPreferenceView = {
  verbosity: 'quiet' | 'normal' | 'chatty'
  spoilers: 'avoid' | 'allow'
  muteUntil: number
}

export type CompanionHostStatus = {
  version: typeof COMPANION_PROTOCOL_VERSION
  stamp: ContextStamp
  capabilities: Record<string, 'supported' | 'partial' | 'unsupported'>
  activeRequestId: string | null
  memory: {
    epoch: number
    recording: boolean
    count: number
    persistence: 'ready' | 'loading' | 'degraded'
    error?: string
    usedBytes?: number
    pendingCount?: number
  }
  naturalEnhancement: boolean
  preferences?: CompanionPreferenceView
}

export type CompanionRouteResult =
  | { kind: 'chat'; stamp: ContextStamp }
  | { kind: 'clarification'; text: string; stamp: ContextStamp }
  | {
      kind: 'control'
      ticketId: string
      goal: string
      shape: 'single' | 'batch' | 'open'
      lifetime: 'goal' | 'until_stopped'
      expiresAt: number
      stamp: ContextStamp
    }

export type CompanionEventBatch = {
  events: CompanionMessageEvent[]
  lastSeq: number
  gap: boolean
  status: CompanionHostStatus
}

export type CompanionMemoryResult = {
  scope: RuntimeScope
  memoryEpoch: number
  episodes: MemoryEpisode[]
}
