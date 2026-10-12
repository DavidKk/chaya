import type { AgentActivityEvent } from '@/lib/game-agent/activity'

import type { ChatLine } from './CompanionChatLine'

const MAX_LINES = 200
const PERSISTED_ACTIVITY = new Set(['thought.updated', 'tool.completed', 'progress.updated', 'model.requested', 'model.completed', 'persistence.degraded'])

export type CompanionTranscript = { messages: ChatLine[]; activity: AgentActivityEvent[] }

function key(gameId: string) {
  return `chaya.companion.transcript.${gameId}`
}

export function loadCompanionTranscript(gameId: string, storage: Storage = localStorage): CompanionTranscript {
  try {
    const parsed = JSON.parse(storage.getItem(key(gameId)) || '') as Partial<CompanionTranscript>
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-MAX_LINES) : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity.filter((event) => PERSISTED_ACTIVITY.has(event.type)).slice(-MAX_LINES) : [],
    }
  } catch {
    return { messages: [], activity: [] }
  }
}

export function saveCompanionTranscript(gameId: string, transcript: CompanionTranscript, storage: Storage = localStorage) {
  const next = { messages: transcript.messages.slice(-MAX_LINES), activity: transcript.activity.filter((event) => PERSISTED_ACTIVITY.has(event.type)).slice(-MAX_LINES) }
  storage.setItem(key(gameId), JSON.stringify(next))
}

export function clearCompanionTranscript(gameId: string, storage: Storage = localStorage) {
  storage.removeItem(key(gameId))
}
