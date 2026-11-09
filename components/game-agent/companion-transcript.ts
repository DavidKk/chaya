import type { AgentActivityEvent } from '@/lib/game-agent/activity'
import { isGameplayActivityType } from '@/lib/game-agent/gameplay-activity'

import type { ChatLine } from './CompanionChatLine'

const MAX_LINES = 200
const PERSISTED_ACTIVITY = new Set([
  'thought.updated',
  'model.thought',
  'tool.started',
  'tool.completed',
  'turn.completed',
  'turn.stopped',
  'turn.failed',
  'task.completed',
  'task.stopped',
  'task.failed',
  'progress.updated',
  'model.requested',
  'model.completed',
  'game.watch.registered',
  'game.watch.paused',
  'game.watch.triggered',
  'persistence.degraded',
])

export function isPersistedCompanionActivity(type: string) {
  return PERSISTED_ACTIVITY.has(type) || isGameplayActivityType(type)
}

export type CompanionTranscript = { messages: ChatLine[]; activity: AgentActivityEvent[] }

function key(gameId: string) {
  return `chaya.companion.transcript.${gameId}`
}

const views = new Map<string, string>()
const viewStorage = {
  getItem: (key: string) => {
    const memory = views.get(key)
    if (memory !== undefined) return memory
    if (typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(key)
      } catch {}
    }
    return null
  },
  setItem: (key: string, value: string) => {
    views.set(key, value)
  },
  removeItem: (key: string) => {
    views.delete(key)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key)
      } catch {}
    }
  },
}

export function loadCompanionTranscript(gameId: string, storage: Pick<Storage, 'getItem'> = viewStorage): CompanionTranscript {
  try {
    const parsed = JSON.parse(storage.getItem(key(gameId)) || '') as Partial<CompanionTranscript>
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-MAX_LINES) : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity.filter((event) => isPersistedCompanionActivity(event.type)).slice(-MAX_LINES) : [],
    }
  } catch {
    return { messages: [], activity: [] }
  }
}

export function saveCompanionTranscript(gameId: string, transcript: CompanionTranscript, storage: Pick<Storage, 'setItem'> = viewStorage) {
  const next = { messages: transcript.messages.slice(-MAX_LINES), activity: transcript.activity.filter((event) => isPersistedCompanionActivity(event.type)).slice(-MAX_LINES) }
  storage.setItem(key(gameId), JSON.stringify(next))
}

export function clearCompanionTranscript(gameId: string, storage: Pick<Storage, 'removeItem'> = viewStorage) {
  storage.removeItem(key(gameId))
}
