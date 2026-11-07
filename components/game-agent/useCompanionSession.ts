'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AgentActivityEvent } from '@/lib/game-agent/activity'
import type { CompanionCharacter } from '@/lib/game-agent/companion'
import type { ContextStamp } from '@/lib/game-agent/companion/types'
import type { AgentTask } from '@/lib/game-agent/runtime/task-controller'
import {
  COMPANION_LOCAL_EVENT,
  type CompanionEventBatch,
  type CompanionHostStatus,
  type CompanionMessageEvent,
  type CompanionRouteResult,
  type CompanionSelection,
} from '@/lib/runtime/companion-protocol'

import { applyControlTurnEvent, controlEventKey, rememberControlEvent } from './companion-control-events'
import { applyCompanionMessageEvent, formatCompanionError } from './companion-event-apply'
import { clearCompanionTranscript, isPersistedCompanionActivity, loadCompanionTranscript } from './companion-transcript'
import type { ChatLine } from './CompanionChatLine'
import type { GameAgentRequest } from './GameAgentWorkspace'
import { readTurnEvents, type TurnEvent } from './turnStream'
import { isCapabilityUnsupported, isCompanionAbortError, toCompanionClientError, useCompanionClient } from './useCompanionClient'
import { useCompanionTranscriptPersistence } from './useCompanionTranscriptPersistence'

const EVENTS_MS = 180
const STATUS_MS = 2_000
const MAX_MESSAGES = 200

type AgentProfile = { id: string; label: string; online: boolean; models: { name: string }[]; defaultModel: string }
type AgentStatus = {
  available: boolean
  profiles: AgentProfile[]
  defaultProfileId: string
  session: {
    id: string
    activeTurnId?: string | null
    activeTurn?: { id: string; state: string; capability?: string; goal?: string; phase?: string } | null
  } | null
  reason: string | null
}

type ChatAck = { requestId: string; messageId: string }

function emptyStamp(gameId: string): ContextStamp {
  return {
    scope: { libraryGameId: gameId, dataRevision: '', playthroughId: '', runtimeInstanceId: '', segmentId: '' },
    contextEpoch: 0,
    factsRevision: 0,
  }
}

function companionViewKey(gameId: string) {
  return `chaya.companion.view.${gameId}`
}

export function loadCompanionView(gameId: string): 'chat' | 'activity' {
  try {
    return localStorage.getItem(companionViewKey(gameId)) === 'activity' ? 'activity' : 'chat'
  } catch {
    return 'chat'
  }
}

export function useCompanionSession(input: {
  gameId: string
  visible: boolean
  locale: string
  character: CompanionCharacter
  profileId: string
  model: string
  request: GameAgentRequest
  onProfiles?: (status: AgentStatus) => void
}) {
  const { gameId, visible, locale, character, profileId, model, request, onProfiles } = input
  const call = useCompanionClient(gameId, request)
  const consumerIdRef = useRef(crypto.randomUUID())
  const conversationIdRef = useRef(crypto.randomUUID())
  const afterSeqRef = useRef(0)
  const seenSeqRef = useRef<Set<number>>(new Set())
  const seenMessageRef = useRef<Set<string>>(new Set())
  const messagesRef = useRef<ChatLine[]>(loadCompanionTranscript(gameId).messages)
  const chatRequestIdRef = useRef('')
  const controlAbortRef = useRef<AbortController | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const generationRef = useRef(0)
  const chatAbortRef = useRef<AbortController | null>(null)
  const pollAbortRef = useRef<AbortController | null>(new AbortController())
  const pollInFlightRef = useRef(false)
  const runtimeKeyRef = useRef('')
  const seenControlRef = useRef<Set<string>>(new Set())
  const cancelUnknownRef = useRef(false)

  const [messages, setMessages] = useState<ChatLine[]>(() => messagesRef.current)
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>(() => loadCompanionTranscript(gameId).activity)
  const [hostStatus, setHostStatus] = useState<CompanionHostStatus | null>(null)
  const hostStatusRef = useRef<CompanionHostStatus | null>(null)
  hostStatusRef.current = hostStatus
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null)
  const [gap, setGap] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const chatBusyRef = useRef(false)
  chatBusyRef.current = chatBusy
  const [chatProgress, setChatProgress] = useState('')
  const [activeReplyId, setActiveReplyId] = useState('')
  const [controlTaskId, setControlTaskId] = useState('')
  const [controlProgress, setControlProgress] = useState('')
  const controlProgressRef = useRef('')
  controlProgressRef.current = controlProgress
  const [question, setQuestion] = useState('')
  const [controlStarting, setControlStarting] = useState(false)
  const controlStartingRef = useRef(false)
  controlStartingRef.current = controlStarting
  const [latestThought, setLatestThought] = useState<import('./companion-control-events').ModelThought | null>(null)
  const [hostMissing, setHostMissing] = useState(false)
  const [cancelUnknown, setCancelUnknown] = useState(false)
  const [conversationId, setConversationId] = useState(conversationIdRef.current)

  const selection = useCallback((): CompanionSelection => ({ profileId, model, locale, character }), [character, locale, model, profileId])

  const append = useCallback((line: ChatLine) => {
    messagesRef.current = [...messagesRef.current, line].slice(-MAX_MESSAGES)
    setMessages(messagesRef.current)
  }, [])

  const updateCards = useCallback((match: (line: ChatLine) => boolean, patch: Partial<ChatLine>) => {
    messagesRef.current = messagesRef.current.map((line) => (line.card && match(line) ? { ...line, ...patch } : line))
    setMessages(messagesRef.current)
  }, [])

  const recordActivity = useCallback((item: TurnEvent) => {
    if (!isPersistedCompanionActivity(item.type)) return
    const { type, seq, ...data } = item
    setActivityEvents((current) => [...current.filter((event) => event.seq !== (seq || 0)), { seq: seq || current.length + 1, type, at: Date.now(), data }].slice(-200))
  }, [])

  const applyCompanionEvent = useCallback(
    (event: CompanionMessageEvent) => {
      const result = applyCompanionMessageEvent(
        {
          consumerId: consumerIdRef.current,
          conversationId: conversationIdRef.current,
          chatRequestId: chatRequestIdRef.current,
          character,
          messages: messagesRef.current,
          seenSeq: seenSeqRef.current,
          seenKeys: seenMessageRef.current,
          afterSeq: afterSeqRef.current,
          gameId,
          runtimeInstanceId: hostStatusRef.current?.stamp.scope.runtimeInstanceId,
        },
        event
      )
      afterSeqRef.current = result.afterSeq
      chatRequestIdRef.current = result.chatRequestId
      if (result.messages) {
        messagesRef.current = result.messages
        setMessages(result.messages)
      }
      if (result.chatBusy !== null) setChatBusy(result.chatBusy)
      if (result.chatProgress !== null) setChatProgress(result.chatProgress)
      if (result.activeReplyId !== null) setActiveReplyId(result.activeReplyId)
      if (result.clearQuestion) setQuestion('')
      if (result.chatBusy === false) {
        cancelUnknownRef.current = false
        setCancelUnknown(false)
      }
    },
    [character, gameId]
  )

  const abortChat = useCallback((reason: string) => {
    chatAbortRef.current?.abort(new DOMException(reason, 'AbortError'))
    chatAbortRef.current = null
  }, [])

  const abortControlLocal = useCallback((reason: string) => {
    controlAbortRef.current?.abort(new DOMException(reason, 'AbortError'))
    controlAbortRef.current = null
    void readerRef.current?.cancel().catch(() => {})
    readerRef.current = null
  }, [])

  const bumpGeneration = useCallback(
    (reason: string) => {
      generationRef.current += 1
      abortChat(reason)
      pollAbortRef.current?.abort(new DOMException(reason, 'AbortError'))
      pollAbortRef.current = new AbortController()
    },
    [abortChat]
  )

  const refreshHostStatus = useCallback(async () => {
    try {
      const status = await call<CompanionHostStatus>({ type: 'agent.companion.status', requestId: crypto.randomUUID() }, pollAbortRef.current?.signal)
      setHostStatus(status)
      setHostMissing(false)
    } catch (error) {
      if (isCompanionAbortError(error)) return
      if (isCapabilityUnsupported(error)) setHostMissing(true)
      setHostStatus(null)
      setAgentStatus((current) => current || { available: false, profiles: [], defaultProfileId: '', session: null, reason: formatCompanionError(error) })
    }
  }, [call])

  const refreshAgentStatus = useCallback(async () => {
    try {
      const response = await request(`/api/game-agent/status?gameId=${encodeURIComponent(gameId)}`)
      const body = (await response.json()) as AgentStatus
      if (!response.ok) throw toCompanionClientError(body, `HTTP ${response.status}`, response.status)
      setAgentStatus(body)
      onProfiles?.(body)
      const active = body.session?.activeTurn
      if (active && (active.capability === 'play' || active.capability === 'companion')) {
        setControlTaskId((current) => current || active.id)
        setControlProgress((current) => current || active.phase || '托管推进中…')
      } else if (!readerRef.current && !controlStartingRef.current) {
        setControlTaskId('')
        setControlProgress('')
      }
    } catch (error) {
      if (isCompanionAbortError(error)) return
      setAgentStatus({ available: false, profiles: [], defaultProfileId: '', session: null, reason: formatCompanionError(error) })
    }
  }, [gameId, onProfiles, request])

  const pollEvents = useCallback(
    async (isVisible: boolean) => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      const generation = generationRef.current
      try {
        const batch = await call<CompanionEventBatch>(
          {
            type: 'agent.companion.events',
            requestId: crypto.randomUUID(),
            afterSeq: afterSeqRef.current,
            consumerId: consumerIdRef.current,
            visible: isVisible,
            locale,
            character,
            conversationId: conversationIdRef.current,
          },
          pollAbortRef.current?.signal
        )
        if (generation !== generationRef.current) return
        setHostStatus(batch.status)
        setHostMissing(false)
        setGap(Boolean(batch.gap))
        afterSeqRef.current = Math.max(afterSeqRef.current, batch.lastSeq || afterSeqRef.current)
        for (const event of batch.events || []) applyCompanionEvent(event)
      } catch (error) {
        if (isCompanionAbortError(error) || generation !== generationRef.current) return
        if (isCapabilityUnsupported(error)) setHostMissing(true)
      } finally {
        pollInFlightRef.current = false
      }
    },
    [applyCompanionEvent, call, character, locale]
  )

  const cancelChat = useCallback(async () => {
    const target = chatRequestIdRef.current
    const generation = generationRef.current
    abortChat('cancel')
    if (!target) {
      setChatBusy(false)
      setChatProgress('')
      setActiveReplyId('')
      setCancelUnknown(false)
      cancelUnknownRef.current = false
      return
    }
    try {
      await call({ type: 'agent.companion.cancel', requestId: crypto.randomUUID(), targetRequestId: target })
      if (generation !== generationRef.current) return
      chatRequestIdRef.current = ''
      setChatBusy(false)
      setChatProgress('')
      setActiveReplyId('')
      setCancelUnknown(false)
      cancelUnknownRef.current = false
    } catch (error) {
      if (isCompanionAbortError(error) || generation !== generationRef.current) return
      cancelUnknownRef.current = true
      setCancelUnknown(true)
      append({ id: crypto.randomUUID(), role: 'error', text: formatCompanionError(error) })
    }
  }, [abortChat, append, call])

  const stopControl = useCallback(async () => {
    const taskId = controlTaskId
    abortControlLocal('stop')
    setControlTaskId('')
    setControlProgress('')
    setQuestion('')
    setControlStarting(false)
    if (!taskId) {
      abortChat('stop')
      return
    }
    try {
      const response = await request(`/api/game-agent/turn/${encodeURIComponent(taskId)}?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' })
      if (!response.ok) throw toCompanionClientError(await response.json().catch(() => null), `HTTP ${response.status}`, response.status)
    } catch (error) {
      if (!isCompanionAbortError(error)) {
        const formatted = formatCompanionError(error)
        if (!formatted.includes("Task not found") && !formatted.includes("AGENT_TURN_NOT_FOUND")) {
          append({ id: crypto.randomUUID(), role: 'error', text: formatted })
        }
      }
    } finally {
      void refreshAgentStatus()
    }
  }, [abortChat, abortControlLocal, append, controlTaskId, gameId, refreshAgentStatus, request])

  const watchControlTask = useCallback(
    async (task: Pick<AgentTask, 'id'> & { goal?: string }) => {
      setControlTaskId(task.id)
      setControlProgress(task.goal || '托管进行中')
      const abort = new AbortController()
      controlAbortRef.current?.abort()
      controlAbortRef.current = abort
      try {
        const response = await request(`/api/game-agent/turn/${encodeURIComponent(task.id)}/events?gameId=${encodeURIComponent(gameId)}&after=0`, {
          signal: abort.signal,
        })
        if (!response.ok || !response.body) throw toCompanionClientError(await response.json().catch(() => null), `HTTP ${response.status}`, response.status)
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
        await readTurnEvents(
          response.body,
          (item) => {
            recordActivity(item)
            if (!rememberControlEvent(seenControlRef.current, controlEventKey(task.id, item))) return
            const result = applyControlTurnEvent({ taskId: task.id, item, character, messages: messagesRef.current })
            if (result.messages) {
              messagesRef.current = result.messages
              setMessages(result.messages)
            }
            if (result.question !== undefined) setQuestion(result.question || '')
            if (result.controlProgress !== undefined) setControlProgress(result.controlProgress || '')
            if (result.latestThought !== undefined) setLatestThought(result.latestThought)
            if (result.appendError) append({ id: crypto.randomUUID(), role: 'error', text: result.appendError })
            if (result.appendText) append({ id: crypto.randomUUID(), role: 'chaya', text: result.appendText, character })
            if (result.ended) {
              setControlTaskId('')
              setControlProgress('')
              setQuestion('')
            }
          },
          {
            signal: abort.signal,
            onReader: (next) => {
              reader = next
              readerRef.current = next
            },
          }
        )
        if (readerRef.current === reader) readerRef.current = null
      } catch (error) {
        if (!isCompanionAbortError(error)) {
          const formatted = formatCompanionError(error)
          if (!formatted.includes("Task not found")) {
            append({ id: crypto.randomUUID(), role: 'error', text: formatted })
          } else {
            setControlTaskId("")
            setControlProgress("")
          }
        }
      } finally {
        if (controlAbortRef.current === abort) controlAbortRef.current = null
        void refreshAgentStatus()
      }
    },
    [append, character, gameId, recordActivity, refreshAgentStatus, request]
  )

  const sendPrompt = useCallback(
    async (text: string) => {
      if (!text.trim()) return
      if (chatBusy) {
        append({ id: crypto.randomUUID(), role: 'error', text: '上一条回复还在生成，请先停止或稍候再发' })
        return
      }
      append({ id: crypto.randomUUID(), role: 'player', text })
      const generation = generationRef.current
      const routeRequestId = crypto.randomUUID()
      const chatRequestId = crypto.randomUUID()
      abortChat('replace')
      const abort = new AbortController()
      chatAbortRef.current = abort
      setChatBusy(true)
      const isCustodyPrompt = /^(开启|开始|启动|帮我|请帮我)?\s*(托管|全托管|全剧情托管|剧情全托管|全托管剧情|托管剧情|剧情托管|自律推进|继续剧情|自动过剧情|自动剧情|过剧情|代打剧情)(\s*(剧情|探索|模式|游玩))?$/i.test(text.trim())
      if (isCustodyPrompt) {
        setControlStarting(true)
        setControlProgress('托管启动中…')
      }
      setChatProgress(isCustodyPrompt ? '托管启动中…' : '路由中…')
      chatRequestIdRef.current = routeRequestId
      try {
        const routed = await call<CompanionRouteResult>(
          {
            type: 'agent.companion.route',
            requestId: routeRequestId,
            prompt: text,
            conversationId: conversationIdRef.current,
            ...selection(),
          },
          abort.signal
        )
        if (generation !== generationRef.current || abort.signal.aborted) return
        if (routed.kind === 'clarification') {
          if (isCustodyPrompt) {
            setControlStarting(false)
            setControlProgress('')
          }
          chatRequestIdRef.current = ''
          setChatBusy(false)
          setChatProgress('')
          append({ id: crypto.randomUUID(), role: 'chaya', text: routed.text, character })
          return
        }
        if (routed.kind === 'control') {
          chatRequestIdRef.current = ''
          setChatBusy(false)
          setChatProgress('')
          setControlStarting(true)
          setControlProgress(routed.goal || '托管启动中…')
          try {
            const task = await call<AgentTask>(
              {
                type: 'agent.companion.control.start',
                requestId: crypto.randomUUID(),
                ticketId: routed.ticketId,
              },
              abort.signal
            )
            if (generation !== generationRef.current || abort.signal.aborted) return
            void watchControlTask(task)
          } catch (error) {
            if (isCompanionAbortError(error) || generation !== generationRef.current) return
            if (isCapabilityUnsupported(error)) setHostMissing(true)
            setControlProgress('')
            const formatted = formatCompanionError(error)
            if (!formatted.includes("Task not found") && !formatted.includes("AGENT_TURN_NOT_FOUND")) {
              append({ id: crypto.randomUUID(), role: 'error', text: formatted })
            }
          } finally {
            if (generation === generationRef.current) setControlStarting(false)
          }
          return
        }
        if (isCustodyPrompt) {
          setControlStarting(false)
          setControlProgress('')
        }
        const stamp = routed.stamp || hostStatus?.stamp || emptyStamp(gameId)
        chatRequestIdRef.current = chatRequestId
        setChatProgress('生成中…')
        const ack = await call<ChatAck>(
          {
            type: 'agent.companion.chat',
            requestId: chatRequestId,
            prompt: text,
            conversationId: conversationIdRef.current,
            stamp,
            ...selection(),
          },
          abort.signal
        )
        if (generation !== generationRef.current || abort.signal.aborted) return
        chatRequestIdRef.current = ack.requestId || chatRequestId
        setActiveReplyId(ack.messageId)
        if (!messagesRef.current.some((line) => line.id === ack.messageId)) {
          append({ id: ack.messageId, role: 'chaya', text: '', character })
        }
      } catch (error) {
        if (isCustodyPrompt && generation === generationRef.current) {
          setControlStarting(false)
          setControlProgress('')
        }
        if (isCompanionAbortError(error) || generation !== generationRef.current) return
        if (isCapabilityUnsupported(error)) setHostMissing(true)
        chatRequestIdRef.current = ''
        setChatBusy(false)
        setChatProgress('')
        setActiveReplyId('')
        append({ id: crypto.randomUUID(), role: 'error', text: formatCompanionError(error) })
      }
    },
    [abortChat, append, call, character, chatBusy, gameId, hostStatus?.stamp, selection, watchControlTask]
  )

  const replyToCard = useCallback(
    async (taskId: string, reply: string) => {
      const pending = (line: ChatLine) => line.cardTurnId === taskId && line.cardState === 'pending'
      const waiting = messagesRef.current.filter(pending).map((line) => line.id)
      const previousQuestion = question
      updateCards(pending, { cardState: 'answered', cardAnswer: reply })
      setQuestion('')
      try {
        const response = await request(`/api/game-agent/turn/${encodeURIComponent(taskId)}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, reply, replyId: crypto.randomUUID() }),
        })
        if (!response.ok) throw toCompanionClientError(await response.json().catch(() => null), `HTTP ${response.status}`, response.status)
        setControlProgress('思考中…')
      } catch (error) {
        updateCards((line) => waiting.includes(line.id), { cardState: 'pending', cardAnswer: undefined })
        setQuestion(previousQuestion)
        append({ id: crypto.randomUUID(), role: 'error', text: formatCompanionError(error) })
      }
    },
    [append, gameId, question, request, updateCards]
  )

  const beginConversation = useCallback(() => {
    conversationIdRef.current = crypto.randomUUID()
    setConversationId(conversationIdRef.current)
  }, [])

  const clearChat = useCallback(async () => {
    await cancelChat()
    beginConversation()
    messagesRef.current = []
    setMessages([])
    setActivityEvents([])
    seenSeqRef.current.clear()
    seenMessageRef.current.clear()
    clearCompanionTranscript(gameId)
  }, [beginConversation, cancelChat, gameId])

  useCompanionTranscriptPersistence(gameId, request, { messages, activity: activityEvents }, (loaded) => {
    messagesRef.current = loaded.messages
    setMessages(loaded.messages)
    setActivityEvents(loaded.activity)
  })

  const identityKey = `${character}:${locale}`
  const identityRef = useRef(identityKey)
  useEffect(() => {
    if (identityRef.current === identityKey) return
    identityRef.current = identityKey
    const target = chatRequestIdRef.current
    bumpGeneration('identity')
    beginConversation()
    chatRequestIdRef.current = ''
    setChatBusy(false)
    setChatProgress('')
    setActiveReplyId('')
    if (target) void call({ type: 'agent.companion.cancel', requestId: crypto.randomUUID(), targetRequestId: target }).catch(() => {})
  }, [beginConversation, bumpGeneration, call, identityKey])

  useEffect(() => {
    const runtimeId = hostStatus?.stamp.scope.runtimeInstanceId || ''
    const [currentGameId, currentRuntimeId = ''] = runtimeKeyRef.current.split(':')
    const gameChanged = currentGameId !== gameId
    const runtimeChanged = Boolean(currentRuntimeId) && Boolean(runtimeId) && runtimeId !== currentRuntimeId
    if (!runtimeKeyRef.current) {
      runtimeKeyRef.current = `${gameId}:${runtimeId}`
      const loaded = loadCompanionTranscript(gameId)
      messagesRef.current = loaded.messages
      setMessages(loaded.messages)
      setActivityEvents(loaded.activity)
      return
    }
    if (!gameChanged && !runtimeChanged) {
      if (runtimeId) runtimeKeyRef.current = `${gameId}:${runtimeId}`
      return
    }
    runtimeKeyRef.current = `${gameId}:${runtimeId}`
    bumpGeneration('scope')
    abortControlLocal('scope')
    afterSeqRef.current = 0
    seenSeqRef.current.clear()
    seenMessageRef.current.clear()
    seenControlRef.current.clear()
    beginConversation()
    const loaded = loadCompanionTranscript(gameId)
    messagesRef.current = loaded.messages.map((line) => (line.card && line.cardState === 'pending' ? { ...line, cardState: 'expired' as const } : line))
    setMessages(messagesRef.current)
    setActivityEvents(loaded.activity)
    setGap(false)
    const target = chatRequestIdRef.current
    chatRequestIdRef.current = ''
    setChatBusy(false)
    setChatProgress('')
    setActiveReplyId('')
    if (target) void call({ type: 'agent.companion.cancel', requestId: crypto.randomUUID(), targetRequestId: target }).catch(() => {})
    if (gameChanged) {
      setControlTaskId('')
      setControlProgress('')
      setQuestion('')
      setControlStarting(false)
    } else {
      setQuestion('')
    }
  }, [abortControlLocal, beginConversation, bumpGeneration, call, gameId, hostStatus?.stamp.scope.runtimeInstanceId])

  useEffect(() => {
    if (!visible) {
      void cancelChat()
      void pollEvents(false)
      return
    }

    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    void refreshHostStatus()
    void refreshAgentStatus()
    void pollEvents(true)

    const schedulePoll = () => {
      if (!active) return
      const delay = chatBusyRef.current ? 600 : 2_500
      pollTimer = setTimeout(async () => {
        if (!active) return
        await pollEvents(true)
        schedulePoll()
      }, delay)
    }

    schedulePoll()

    const statusTimer = setInterval(() => {
      if (active) void refreshAgentStatus()
    }, 4_000)

    return () => {
      active = false
      if (pollTimer) clearTimeout(pollTimer)
      clearInterval(statusTimer)
    }
  }, [cancelChat, pollEvents, refreshAgentStatus, refreshHostStatus, visible])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onLocal = (raw: Event) => {
      const detail = (raw as CustomEvent<CompanionMessageEvent>).detail
      if (!detail || typeof detail !== 'object' || !detail.messageId || !detail.kind) return
      applyCompanionEvent(detail)
    }
    window.addEventListener(COMPANION_LOCAL_EVENT, onLocal as EventListener)
    return () => window.removeEventListener(COMPANION_LOCAL_EVENT, onLocal as EventListener)
  }, [applyCompanionEvent])

  useEffect(() => {
    if (!controlTaskId || readerRef.current || controlAbortRef.current) return
    void watchControlTask({ id: controlTaskId, goal: controlProgressRef.current || '托管进行中' })
  }, [controlTaskId, hostStatus?.stamp.scope.runtimeInstanceId, watchControlTask])

  useEffect(() => {
    return () => {
      generationRef.current += 1
      abortChat('unmount')
      pollAbortRef.current?.abort()
      abortControlLocal('unmount')
    }
  }, [abortChat, abortControlLocal])

  return {
    messages,
    activityEvents,
    hostStatus,
    agentStatus,
    gap,
    hostMissing,
    cancelUnknown,
    chatBusy,
    chatProgress,
    activeReplyId,
    controlTaskId,
    controlBusy: controlStarting || !!controlTaskId,
    controlProgress,
    question,
    conversationId,
    latestThought,
    append,
    updateCards,
    sendPrompt,
    cancelChat,
    stopControl,
    replyToCard,
    clearChat,
    call,
    refreshHostStatus,
  }
}

export function saveCompanionView(gameId: string, tab: 'chat' | 'activity') {
  try {
    localStorage.setItem(companionViewKey(gameId), tab)
  } catch {
    // Session state still works without persistence.
  }
}
