import type { CompanionCharacter } from '@/lib/game-agent/companion'
import type { CompanionMessageEvent } from '@/lib/runtime/companion-protocol'

import type { ChatLine } from './CompanionChatLine'

const SEEN_LIMIT = 256

export type CompanionEventApplyState = {
  consumerId: string
  conversationId: string
  chatRequestId: string
  character: CompanionCharacter
  messages: ChatLine[]
  seenSeq: Set<number>
  seenKeys: Set<string>
  afterSeq: number
  gameId?: string
  runtimeInstanceId?: string
}

export type CompanionEventApplyResult = {
  afterSeq: number
  chatRequestId: string
  chatBusy: boolean | null
  chatProgress: string | null
  activeReplyId: string | null
  clearQuestion: boolean
  messages: ChatLine[] | null
  errorText: string | null
}

function remember(state: CompanionEventApplyState, seq: number, key: string) {
  state.seenSeq.add(seq)
  if (state.seenSeq.size > SEEN_LIMIT) {
    for (const value of [...state.seenSeq].slice(0, state.seenSeq.size - SEEN_LIMIT)) state.seenSeq.delete(value)
  }
  state.seenKeys.add(key)
  if (state.seenKeys.size > SEEN_LIMIT) {
    for (const value of [...state.seenKeys].slice(0, state.seenKeys.size - SEEN_LIMIT)) state.seenKeys.delete(value)
  }
}

function withLine(messages: ChatLine[], line: ChatLine) {
  return [...messages, line].slice(-200)
}

function patchLine(messages: ChatLine[], id: string, patch: Partial<ChatLine> | ((line: ChatLine) => ChatLine)) {
  return messages.map((line) => {
    if (line.id !== id) return line
    return typeof patch === 'function' ? patch(line) : { ...line, ...patch }
  })
}

export function formatCompanionFailure(error?: { message?: string; code?: string; retryable?: boolean } | null, fallback = '旅伴回复失败') {
  const message = error?.message || fallback
  if (!error?.code) return message
  return error.retryable ? `${message} (${error.code} · 可重试)` : `${message} (${error.code})`
}

export function formatCompanionError(error: unknown, fallback = '旅伴请求失败') {
  if (error && typeof error === 'object' && ('code' in error || 'message' in error)) {
    return formatCompanionFailure(error as { message?: string; code?: string; retryable?: boolean }, fallback)
  }
  return error instanceof Error ? error.message : String(error)
}

/** Shared by CustomEvent and events-batch polling. Cursor advances for foreign traffic; delivery is filtered. */
export function applyCompanionMessageEvent(state: CompanionEventApplyState, event: CompanionMessageEvent): CompanionEventApplyResult {
  const afterSeq = Math.max(state.afterSeq, event.seq || 0)
  const eventKey = `${event.seq}:${event.messageId}:${event.kind}`
  const base: CompanionEventApplyResult = {
    afterSeq,
    chatRequestId: state.chatRequestId,
    chatBusy: null,
    chatProgress: null,
    activeReplyId: null,
    clearQuestion: false,
    messages: null,
    errorText: null,
  }
  if (state.seenKeys.has(eventKey)) return { ...base, afterSeq }

  const scope = event.stamp?.scope
  if (state.gameId && scope?.libraryGameId && scope.libraryGameId !== state.gameId) {
    remember(state, event.seq, eventKey)
    return { ...base, afterSeq }
  }
  if (state.runtimeInstanceId && scope?.runtimeInstanceId && scope.runtimeInstanceId !== state.runtimeInstanceId) {
    remember(state, event.seq, eventKey)
    return { ...base, afterSeq }
  }

  if (event.kind === 'cue') {
    remember(state, event.seq, eventKey)
    if (event.consumerId && event.consumerId !== state.consumerId) return { ...base, afterSeq }
    const text = event.text || event.cue?.kind || ''
    if (!text || state.messages.some((line) => line.id === event.messageId)) return { ...base, afterSeq }
    return { ...base, afterSeq, messages: withLine(state.messages, { id: event.messageId, role: 'chaya', text, character: state.character }) }
  }

  if (event.kind === 'context.changed') {
    remember(state, event.seq, eventKey)
    return {
      ...base,
      afterSeq,
      clearQuestion: true,
      messages: state.messages.map((line) => (line.card && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line)),
    }
  }

  if (event.conversationId && event.conversationId !== state.conversationId) {
    remember(state, event.seq, eventKey)
    return { ...base, afterSeq }
  }

  remember(state, event.seq, eventKey)

  if (event.kind === 'model.status') {
    if (!event.requestId || event.requestId !== state.chatRequestId || !event.modelStatus) return base
    if (event.modelStatus.phase !== 'loading' && event.modelStatus.phase !== 'ready') return base
    return {
      ...base,
      chatProgress:
        event.modelStatus.phase === 'loading'
          ? '模型需要冷启动，正在加载，首次使用可能较慢…'
          : event.modelStatus.residency === 'unknown'
            ? '正在连接模型，准备生成…'
            : '模型已就绪，正在处理…',
    }
  }

  if (event.kind === 'accepted' || event.kind === 'queued') {
    if (event.requestId && event.requestId === state.chatRequestId) {
      return { ...base, afterSeq, chatProgress: event.kind === 'queued' ? '排队中…' : '生成中…' }
    }
    return { ...base, afterSeq }
  }

  if (event.kind === 'delta') {
    const chunk = event.text || ''
    const messages = state.messages.some((line) => line.id === event.messageId)
      ? patchLine(state.messages, event.messageId, (line) => ({ ...line, text: line.text + chunk }))
      : withLine(state.messages, { id: event.messageId, role: 'chaya', text: chunk, character: state.character })
    return {
      ...base,
      afterSeq,
      messages,
      activeReplyId: event.requestId === state.chatRequestId ? event.messageId : null,
    }
  }

  if (event.kind === 'completed') {
    let messages: ChatLine[] | null = null
    const thoughtObj = event.thought
      ? {
          id: crypto.randomUUID(),
          model: '',
          durationMs: event.metrics?.generationMs || 0,
          thought: event.thought,
          at: Date.now(),
        }
      : undefined
    if (event.text || thoughtObj) {
      const linePatch: Partial<ChatLine> = {
        text: event.text || '',
        ...(thoughtObj ? { thought: thoughtObj } : {}),
      }
      messages = state.messages.some((line) => line.id === event.messageId)
        ? patchLine(state.messages, event.messageId, linePatch)
        : withLine(state.messages, {
            id: event.messageId,
            role: 'chaya',
            text: event.text || '',
            character: state.character,
            ...(thoughtObj ? { thought: thoughtObj } : {}),
          })
    }
    if (event.requestId === state.chatRequestId) {
      return { ...base, afterSeq, messages, chatRequestId: '', chatBusy: false, chatProgress: '', activeReplyId: '' }
    }
    return { ...base, afterSeq, messages }
  }

  if (event.kind === 'cancelled') {
    const line = state.messages.find((item) => item.id === event.messageId)
    const messages = line && !line.text ? state.messages.filter((item) => item.id !== event.messageId) : null
    if (event.requestId === state.chatRequestId) {
      return { ...base, afterSeq, messages, chatRequestId: '', chatBusy: false, chatProgress: '', activeReplyId: '' }
    }
    return { ...base, afterSeq, messages }
  }

  if (event.kind === 'failed') {
    const messages = state.messages.filter((item) => item.id !== event.messageId || !!item.text)
    const errorText = formatCompanionFailure(event.error)
    if (event.requestId === state.chatRequestId) {
      return {
        ...base,
        afterSeq,
        messages: withLine(messages, { id: crypto.randomUUID(), role: 'error', text: errorText }),
        chatRequestId: '',
        chatBusy: false,
        chatProgress: '',
        activeReplyId: '',
        errorText: null,
      }
    }
    return { ...base, afterSeq, messages: withLine(messages, { id: crypto.randomUUID(), role: 'error', text: errorText }) }
  }

  return { ...base, afterSeq }
}
