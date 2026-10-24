/**
 * Request ledger: idempotent replay, conflict detection, control tickets,
 * bounded event log and conversation history for companion host (T5).
 */

import type { CompanionError, ContextStamp } from '@/lib/game-agent/companion/types'
import type { CompanionHostRequest, CompanionMessageEvent, CompanionSelection } from '@/lib/runtime/companion-protocol'

export const EVENT_LOG_MAX = 128
export const EVENT_LOG_MAX_BYTES = 256 * 1024
export const CONVERSATION_MAX_MESSAGES = 20
export const CONVERSATION_MAX_BYTES = 32 * 1024
export const IDEMPOTENT_MAX_ENTRIES = 64
export const IDEMPOTENT_TTL_MS = 10 * 60_000
export const IDEMPOTENT_MAX_BYTES = 96 * 1024
export const CONTROL_TICKET_TTL_MS = 60_000
export const CONTROL_TICKET_MAX = 8
export const CONVERSATION_MAX = 8
export const CONSUMER_TTL_MS = 15_000
export const CONSUMER_MAX = 8

export type ControlTicket = {
  ticketId: string
  requestId: string
  prompt: string
  goal: string
  action: string
  shape: 'single' | 'batch' | 'open'
  lifetime: 'goal' | 'until_stopped'
  stamp: ContextStamp
  selection: CompanionSelection
  conversationId: string
  expiresAt: number
  createdAt: number
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string; at: number; conversationId: string }

type IdempotentEntry = {
  requestId: string
  fingerprint: string
  result?: unknown
  inflight?: Promise<unknown>
  at: number
  bytes: number
}

export type EventConsumer = {
  consumerId: string
  visible: boolean
  locale: string
  character: string
  lastSeenAt: number
}

function bytesOf(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

export function fingerprintRequest(message: CompanionHostRequest): string {
  const { requestId: _requestId, ...rest } = message as CompanionHostRequest & { requestId: string }
  return JSON.stringify(rest)
}

export function companionError(code: CompanionError['code'], message: string, options?: { retryable?: boolean; requestId?: string; currentStamp?: ContextStamp }): CompanionError {
  return {
    code,
    message,
    retryable: options?.retryable ?? false,
    requestId: options?.requestId,
    currentStamp: options?.currentStamp,
  }
}

export class CompanionRequestLedger {
  private readonly idempotent = new Map<string, IdempotentEntry>()
  private idempotentBytes = 0
  private readonly tickets = new Map<string, ControlTicket>()
  private events: CompanionMessageEvent[] = []
  private eventBytes = 0
  private seq = 0
  private readonly conversations = new Map<string, ChatTurn[]>()
  private readonly consumers = new Map<string, EventConsumer>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  peekIdempotent(
    message: CompanionHostRequest
  ): { hit: true; result: unknown } | { hit: true; inflight: Promise<unknown> } | { hit: false } | { conflict: true; error: CompanionError } {
    this.pruneIdempotent()
    const existing = this.idempotent.get(message.requestId)
    if (!existing) return { hit: false }
    const fingerprint = fingerprintRequest(message)
    if (existing.fingerprint !== fingerprint) {
      return {
        conflict: true,
        error: companionError('REQUEST_CONFLICT', 'Same requestId with a different payload', {
          requestId: message.requestId,
          retryable: false,
        }),
      }
    }
    if (existing.inflight) return { hit: true, inflight: existing.inflight }
    return { hit: true, result: existing.result }
  }

  /** Register the in-flight promise before awaiting route/control work. */
  beginIdempotent(message: CompanionHostRequest, inflight: Promise<unknown>): void {
    this.pruneIdempotent()
    const fingerprint = fingerprintRequest(message)
    const previous = this.idempotent.get(message.requestId)
    if (previous) this.idempotentBytes -= previous.bytes
    const entry: IdempotentEntry = {
      requestId: message.requestId,
      fingerprint,
      inflight,
      at: this.now(),
      bytes: bytesOf({ fingerprint }),
    }
    this.idempotent.set(message.requestId, entry)
    this.idempotentBytes += entry.bytes
    this.enforceIdempotentBudget()
    if (this.idempotent.size > IDEMPOTENT_MAX_ENTRIES || this.idempotentBytes > IDEMPOTENT_MAX_BYTES) {
      this.idempotent.delete(message.requestId)
      this.idempotentBytes -= entry.bytes
      throw Object.assign(new Error('Companion request ledger is full'), { code: 'MODEL_BUSY', retryable: true })
    }
  }

  rememberIdempotent(message: CompanionHostRequest, result: unknown): void {
    this.pruneIdempotent()
    const fingerprint = fingerprintRequest(message)
    const entry: IdempotentEntry = {
      requestId: message.requestId,
      fingerprint,
      result,
      at: this.now(),
      bytes: bytesOf({ fingerprint, result }),
    }
    const previous = this.idempotent.get(message.requestId)
    if (previous) this.idempotentBytes -= previous.bytes
    this.idempotent.set(message.requestId, entry)
    this.idempotentBytes += entry.bytes
    this.enforceIdempotentBudget()
  }

  failIdempotent(message: CompanionHostRequest): void {
    const existing = this.idempotent.get(message.requestId)
    if (!existing?.inflight) return
    this.idempotentBytes -= existing.bytes
    this.idempotent.delete(message.requestId)
  }

  private pruneIdempotent(): void {
    const cutoff = this.now() - IDEMPOTENT_TTL_MS
    for (const [key, entry] of this.idempotent) {
      if (!entry.inflight && entry.at < cutoff) {
        this.idempotentBytes -= entry.bytes
        this.idempotent.delete(key)
      }
    }
  }

  private enforceIdempotentBudget(): void {
    while (this.idempotent.size > IDEMPOTENT_MAX_ENTRIES || this.idempotentBytes > IDEMPOTENT_MAX_BYTES) {
      const oldest = [...this.idempotent.entries()].filter(([, entry]) => !entry.inflight).sort((a, b) => a[1].at - b[1].at)[0]
      if (!oldest) break
      this.idempotentBytes -= oldest[1].bytes
      this.idempotent.delete(oldest[0])
    }
  }

  putTicket(ticket: ControlTicket): void {
    this.tickets.set(ticket.ticketId, ticket)
    this.pruneTickets()
    while (this.tickets.size > CONTROL_TICKET_MAX) {
      const oldest = [...this.tickets.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
      if (!oldest) break
      this.tickets.delete(oldest.ticketId)
    }
  }

  getTicket(ticketId: string): ControlTicket | undefined {
    this.pruneTickets()
    return this.tickets.get(ticketId)
  }

  takeTicket(ticketId: string): ControlTicket | undefined {
    const ticket = this.getTicket(ticketId)
    if (!ticket) return undefined
    this.tickets.delete(ticketId)
    return ticket
  }

  private pruneTickets(): void {
    const now = this.now()
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(id)
    }
  }

  appendEvent(partial: Omit<CompanionMessageEvent, 'seq' | 'at'> & { at?: number }): CompanionMessageEvent {
    const event: CompanionMessageEvent = {
      ...partial,
      seq: ++this.seq,
      at: partial.at ?? this.now(),
    }
    this.events.push(event)
    this.eventBytes += bytesOf(event)
    while (this.events.length > EVENT_LOG_MAX || this.eventBytes > EVENT_LOG_MAX_BYTES) {
      const removed = this.events.shift()
      if (!removed) break
      this.eventBytes -= bytesOf(removed)
    }
    return event
  }

  readEvents(afterSeq: number, consumerId?: string, conversationId?: string): { events: CompanionMessageEvent[]; lastSeq: number; gap: boolean } {
    const first = this.events[0]
    const gap = !!first && afterSeq + 1 < first.seq && afterSeq > 0
    const events = this.events.filter((event) => {
      if (event.seq <= afterSeq) return false
      if (event.kind === 'cue') {
        // Cue is owned by one active visible consumer.
        return !event.consumerId || !consumerId || event.consumerId === consumerId
      }
      if (event.conversationId && conversationId) return event.conversationId === conversationId || event.kind === 'context.changed'
      if (event.conversationId && consumerId && !conversationId) {
        // Event polls without a chat conversation still receive context / cue, not other chats.
        return event.kind === 'context.changed'
      }
      return true
    })
    return { events, lastSeq: this.seq, gap }
  }

  lastSeq(): number {
    return this.seq
  }

  registerConsumer(input: { consumerId: string; visible: boolean; locale: string; character: string }): number {
    this.pruneConsumers()
    this.consumers.set(input.consumerId, {
      consumerId: input.consumerId,
      visible: input.visible,
      locale: input.locale,
      character: input.character,
      lastSeenAt: this.now(),
    })
    this.enforceConsumerBudget()
    return this.visibleConsumerCount()
  }

  visibleConsumerCount(): number {
    this.pruneConsumers()
    let count = 0
    for (const consumer of this.consumers.values()) if (consumer.visible) count += 1
    return count
  }

  primaryVisibleSelection(): { locale: string; character: string } | null {
    const active = this.activeVisibleConsumer()
    return active ? { locale: active.locale, character: active.character } : null
  }

  activeVisibleConsumer(): EventConsumer | null {
    this.pruneConsumers()
    let best: EventConsumer | null = null
    for (const consumer of this.consumers.values()) {
      if (!consumer.visible) continue
      if (!best || consumer.lastSeenAt >= best.lastSeenAt) best = consumer
    }
    return best
  }

  private pruneConsumers(): void {
    const cutoff = this.now() - CONSUMER_TTL_MS
    for (const [id, consumer] of this.consumers) {
      if (consumer.lastSeenAt < cutoff) this.consumers.delete(id)
    }
  }

  private enforceConsumerBudget(): void {
    while (this.consumers.size > CONSUMER_MAX) {
      const oldest = [...this.consumers.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0]
      if (!oldest) break
      this.consumers.delete(oldest.consumerId)
    }
  }

  appendChat(conversationId: string, turn: Omit<ChatTurn, 'conversationId'>): void {
    const list = this.conversations.get(conversationId) ?? []
    list.push({ ...turn, conversationId })
    let size = bytesOf(list)
    while (list.length > CONVERSATION_MAX_MESSAGES || size > CONVERSATION_MAX_BYTES) {
      list.shift()
      size = bytesOf(list)
    }
    this.conversations.set(conversationId, list)
    while (this.conversations.size > CONVERSATION_MAX) {
      const oldest = [...this.conversations.entries()].map(([id, turns]) => ({ id, at: turns[turns.length - 1]?.at ?? 0 })).sort((a, b) => a.at - b.at)[0]
      if (!oldest || oldest.id === conversationId) break
      this.conversations.delete(oldest.id)
    }
  }

  recentChat(conversationId: string): ChatTurn[] {
    return [...(this.conversations.get(conversationId) ?? [])]
  }

  clearConversation(conversationId?: string): void {
    if (conversationId) this.conversations.delete(conversationId)
    else this.conversations.clear()
  }

  clearGenerationScoped(): void {
    this.tickets.clear()
  }
}
