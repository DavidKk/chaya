import type { CompanionCharacter } from '@/lib/game-agent/companion'
import { parsePlayerCard } from '@/lib/game-agent/player-card'

import type { ChatLine } from './CompanionChatLine'
import type { TurnEvent } from './turnStream'

const SEEN_LIMIT = 256

export type ControlEventResult = {
  messages?: ChatLine[]
  question?: string | null
  controlProgress?: string | null
  ended?: boolean
  appendError?: string
  appendText?: string
}

export function controlEventKey(taskId: string, item: TurnEvent) {
  return `${taskId}:${item.seq ?? 0}:${item.type}:${item.callId || item.stepId || item.actionId || ''}`
}

export function rememberControlEvent(seen: Set<string>, key: string) {
  if (seen.has(key)) return false
  seen.add(key)
  if (seen.size > SEEN_LIMIT) {
    for (const value of [...seen].slice(0, seen.size - SEEN_LIMIT)) seen.delete(value)
  }
  return true
}

export function applyControlTurnEvent(input: { taskId: string; item: TurnEvent; character: CompanionCharacter; messages: ChatLine[] }): ControlEventResult {
  const { taskId, item, character, messages } = input
  if (item.type === 'approval.required' || item.type === 'card.shown') {
    const card = parsePlayerCard(item.card)
    const next = card
      ? [
          ...messages,
          {
            id: crypto.randomUUID(),
            role: 'chaya' as const,
            text: '',
            character,
            card,
            cardState: 'pending' as const,
            cardTurnId: taskId,
          },
        ].slice(-200)
      : undefined
    return {
      messages: next,
      question: item.type === 'approval.required' ? item.question || '' : undefined,
      controlProgress: item.type === 'approval.required' ? '' : undefined,
    }
  }
  if (item.type === 'user.replied') {
    return {
      messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'answered', cardAnswer: item.text } : line)),
      question: '',
    }
  }
  if (item.type === 'tool.started') return { controlProgress: item.name ? `操作中… ${item.name}` : '操作中…' }
  if (item.type === 'phase') {
    const phase = { observing: '观察中…', thinking: '思考中…', acting: '操作中…', verifying: '确认中…' } as const
    const label = item.phase === 'waiting_user' ? '' : phase[item.phase as keyof typeof phase] || '托管进行中'
    return { controlProgress: label && item.step && item.maxSteps ? `${label} ${item.step}/${item.maxSteps}` : label }
  }
  if (item.type === 'progress.updated') return { controlProgress: item.summary || '托管进行中' }
  if (item.type === 'turn.failed') {
    return {
      ended: true,
      appendError: item.message || '托管失败',
      messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
      question: '',
      controlProgress: '',
    }
  }
  if (item.type === 'turn.completed' || item.type === 'turn.stopped') {
    return {
      ended: true,
      appendText: item.type === 'turn.completed' ? (item.brief || item.text || '').trim() || undefined : undefined,
      messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
      question: '',
      controlProgress: '',
    }
  }
  return {}
}
