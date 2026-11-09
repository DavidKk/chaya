import type { CompanionCharacter } from '@/lib/game-agent/companion'
import { parsePlayerCard } from '@/lib/game-agent/player-card'

import type { ChatLine } from './CompanionChatLine'
import type { TurnEvent } from './turnStream'

const SEEN_LIMIT = 256

export type ModelThought = {
  id: string
  model: string
  durationMs: number
  thought?: string
  promptSummary?: string
  decision?: string
  at: number
}

export type ControlEventResult = {
  messages?: ChatLine[]
  question?: string | null
  controlProgress?: string | null
  ended?: boolean
  appendError?: string
  appendText?: string
  latestThought?: ModelThought | null
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
  if (item.type === 'model.thought') {
    const thought: ModelThought = {
      id: item.id || crypto.randomUUID(),
      model: item.model || '',
      durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
      thought: typeof item.thought === 'string' ? item.thought : undefined,
      promptSummary: typeof item.promptSummary === 'string' ? item.promptSummary : undefined,
      decision: typeof item.decision === 'string' ? item.decision : undefined,
      at: typeof item.at === 'number' ? item.at : Date.now(),
    }
    return {
      latestThought: thought,
      messages: [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: 'chaya' as const,
          text: '',
          character,
          thought,
        },
      ].slice(-200),
    }
  }
  if (item.type === 'turn.failed') {
    const isTaskNotFound = String(item.message || '').includes('Task not found')
    if (isTaskNotFound) {
      return {
        ended: true,
        messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
        question: '',
        controlProgress: '',
      }
    }
    return {
      ended: false,
      appendError: item.message || '托管异常',
      messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
    }
  }
  if (item.type === 'turn.completed') {
    return {
      ended: false,
      appendText: (item.brief || item.text || '').trim() || undefined,
      messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
    }
  }
  if (item.type === 'turn.stopped') {
    return {
      ended: true,
      appendText: (item.brief || item.text || '').trim() || undefined,
      messages: messages.map((line) => (line.cardTurnId === taskId && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
      question: '',
      controlProgress: '',
    }
  }
  return {}
}
