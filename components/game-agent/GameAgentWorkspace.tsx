'use client'

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IoArrowUp, IoCheckmark, IoCloseCircleOutline, IoCloseOutline, IoStop, IoTrashOutline } from 'react-icons/io5'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea, Spinner, TruncateText } from '@/components/sk'
import type { AgentActivityEvent } from '@/lib/game-agent/activity'
import { parsePlayerCard } from '@/lib/game-agent/player-card'
import { runRecoverableOperation } from '@/lib/runtime/recoverable-operation'
import { cn } from '@/lib/utils'

import { AgentActivityTimeline } from './AgentActivityTimeline'
import { isPersistedCompanionActivity } from './companion-transcript'
import { GameAgentRuntimeMenu } from './GameAgentRuntimeMenu'
import {
  type AgentWorkspaceCard,
  type AgentWorkspaceMessage as Message,
  type AgentWorkspaceStatus as Status,
  GAME_AGENT_WORKSPACE_COPY as COPY,
  gameAgentErrorMessage as errorMessage,
} from './gameAgentWorkspaceModel'
import { PlayerCardView } from './PlayerCardView'

export type GameAgentRequest = (path: string, init?: RequestInit) => Promise<Response>

function updateCards(messages: Message[], match: (entry: AgentWorkspaceCard) => boolean, patch: Partial<AgentWorkspaceCard>): Message[] {
  return messages.map((message) => (message.cards?.some(match) ? { ...message, cards: message.cards.map((entry) => (match(entry) ? { ...entry, ...patch } : entry)) } : message))
}

type Props = {
  gameId: string
  open?: boolean
  onClose?: () => void
  request: GameAgentRequest
  onConnect?: () => void
  variant?: 'page' | 'sidebar'
}

export function GameAgentWorkspace({ gameId, open = true, onClose, onConnect, request, variant = 'page' }: Props) {
  const locale = useLocaleCode()
  const copy = COPY[locale] || COPY.en
  const [status, setStatus] = useState<Status | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [model, setModel] = useState('')
  const [profileId, setProfileId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [newSession, setNewSession] = useState(false)
  const [turnId, setTurnId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState('')
  const [goal, setGoal] = useState('')
  const [question, setQuestion] = useState('')
  const [reconnectTick, setReconnectTick] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>([])
  const [width, setWidth] = useState(() => {
    const saved = typeof window === 'undefined' ? 400 : Number(localStorage.getItem('chaya.gameAgent.width')) || 400
    return Math.max(320, Math.min(560, saved))
  })
  const abortRef = useRef<AbortController | null>(null)
  const turnGenerationRef = useRef(0)
  const eventSeqRef = useRef(0)
  const assistantIdRef = useRef('')
  const recentRecoveredRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const lastAutoScrollRef = useRef<{ messages: Message[]; phase: string } | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const running = submitting || !!turnId
  /** 问题已在卡片里，状态栏不再重复 */
  const waitingCard = messages.some((message) => message.cards?.some((entry) => entry.state === 'pending'))

  const applyEvent = useCallback(
    (item: {
      type: string
      seq?: number
      turnId?: string
      sessionId?: string
      phase?: string
      summary?: string
      question?: string
      text?: string
      message?: string
      callId?: string
      name?: string
      ok?: boolean
      step?: number
      maxSteps?: number
      cycle?: number
      card?: unknown
    }) => {
      if (item.seq && item.seq <= eventSeqRef.current) return
      eventSeqRef.current = Math.max(eventSeqRef.current, item.seq || 0)
      const assistantId = assistantIdRef.current
      if (isPersistedCompanionActivity(item.type)) {
        const { type, seq, ...data } = item
        setActivityEvents((current) => [...current.filter((event) => event.seq !== (seq || 0)), { seq: seq || current.length + 1, type, data }].slice(-200))
      }
      const card = (item.type === 'approval.required' || item.type === 'card.shown') && parsePlayerCard(item.card)
      if (card) {
        const entry = { id: `card-${item.seq || Date.now()}`, card, state: 'pending' as const }
        setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, cards: [...(message.cards || []), entry] } : message)))
      }
      if (item.type === 'turn.started') {
        setTurnId(item.turnId || '')
        setSessionId(item.sessionId || '')
        setNewSession(false)
      } else if (item.type === 'goal.updated') {
        setGoal(item.summary || '')
      } else if (item.type === 'approval.required') {
        setQuestion(item.question || '')
        setPhase('等待你的决定')
      } else if (item.type === 'user.replied') {
        setMessages((current) => updateCards(current, (entry) => entry.state === 'pending', { state: 'answered', answer: item.text }))
        setQuestion('')
      } else if (item.type === 'history.gap') {
        setMessages((current) => [...current, { id: `gap-${Date.now()}`, role: 'error', text: '较早的进度记录已过期，以下是仍可恢复的内容。' }])
      } else if (item.type === 'phase') {
        const label =
          item.phase === 'observing'
            ? copy.observing
            : item.phase === 'acting'
              ? copy.acting
              : item.phase === 'verifying'
                ? copy.verifying
                : item.phase === 'waiting_user'
                  ? '等待你的决定'
                  : copy.thinking
        setPhase(item.step && item.maxSteps ? `${label} · ${item.step}/${item.maxSteps}` : label)
      } else if (item.type === 'progress.updated' && item.summary) {
        const summary = item.summary
        setPhase(`${copy.running} · ${summary}`)
        setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, progress: [...(message.progress || []), summary].slice(-6) } : message)))
      } else if (item.type === 'tool.started' && item.callId && item.name) {
        setPhase(`${copy.toolCalling} ${item.name}…`)
        const callId = item.callId
        const name = item.name
        setMessages((current) =>
          current.map((message) => (message.id === assistantId ? { ...message, tools: [...(message.tools || []), { id: callId, name, state: 'running' }] } : message))
        )
      } else if (item.type === 'tool.completed' && item.callId) {
        const callId = item.callId
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, tools: message.tools?.map((tool) => (tool.id === callId ? { ...tool, state: item.ok ? 'completed' : 'failed' } : tool)) }
              : message
          )
        )
      } else if (item.type === 'assistant.delta') {
        setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, text: message.text + (item.text || '') } : message)))
      } else if (item.type === 'turn.failed') {
        setMessages((current) => [...current, { id: `error-${Date.now()}`, role: 'error', text: item.message || 'Agent failed' }])
      }
      if (['turn.completed', 'turn.stopped', 'turn.failed'].includes(item.type)) {
        setMessages((current) => updateCards(current, (entry) => entry.state === 'pending', { state: 'expired' }))
        recentRecoveredRef.current = true
        setTurnId('')
        setPhase('')
        setQuestion('')
      }
    },
    [copy]
  )

  const consumeStream = useCallback(
    async (response: Response, generation: number) => {
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done || generation !== turnGenerationRef.current) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const data = chunk
            .split(/\r?\n/)
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
            .trim()
          if (data && generation === turnGenerationRef.current) applyEvent(JSON.parse(data))
        }
      }
    },
    [applyEvent]
  )

  const refresh = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const response = await request(`/api/game-agent/status?gameId=${encodeURIComponent(gameId)}`)
      const body = (await response.json()) as Status & { ok?: boolean }
      if (!response.ok) throw new Error(errorMessage(body, `HTTP ${response.status}`))
      setStatus(body)
      if (!body.session?.activeTurnId && !abortRef.current) {
        setTurnId('')
        setQuestion('')
      }
      const nextProfileId = body.profiles.some((item) => item.id === profileId) ? profileId : body.defaultProfileId
      const nextProfile = body.profiles.find((item) => item.id === nextProfileId)
      setProfileId(nextProfileId)
      setModel((current) => (nextProfile?.models.some((item) => item.name === current) ? current : nextProfile?.defaultModel || ''))
      setSessionId(body.session?.id || '')
    } catch (error) {
      setStatus({
        available: false,
        gameOnline: false,
        profiles: [],
        defaultProfileId: '',
        session: null,
        reason: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoadingStatus(false)
    }
  }, [gameId, profileId, request])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) {
      turnGenerationRef.current += 1
      abortRef.current?.abort()
    }
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    const active = status?.session?.activeTurn
    const recentId = !active && !recentRecoveredRef.current ? status?.session?.recentTurnId : null
    const targetId = active?.id || recentId
    if (!open || !targetId || abortRef.current) return
    if (!active) recentRecoveredRef.current = true
    assistantIdRef.current = `assistant-recovered-${targetId}`
    setMessages((current) =>
      current.some((message) => message.id === assistantIdRef.current) ? current : [...current, { id: assistantIdRef.current, role: 'assistant', text: '' }]
    )
    if (active) {
      setTurnId(active.id)
      setGoal(active.goal || '')
      setQuestion(active.question || '')
    }
    const abort = new AbortController()
    const generation = ++turnGenerationRef.current
    abortRef.current = abort
    void request(`/api/game-agent/turn/${encodeURIComponent(targetId)}/events?gameId=${encodeURIComponent(gameId)}&after=${eventSeqRef.current}`, { signal: abort.signal })
      .then((response) => consumeStream(response, generation))
      .catch(() => {})
      .finally(() => {
        if (abortRef.current === abort) abortRef.current = null
        if (!abort.signal.aborted && generation === turnGenerationRef.current) {
          void refresh()
          window.setTimeout(() => setReconnectTick((value) => value + 1), 1_000)
        }
      })
    return () => abort.abort()
  }, [open, status?.session?.activeTurn, status?.session?.recentTurnId, request, gameId, consumeStream, reconnectTick, refresh])

  useEffect(() => {
    if (lastAutoScrollRef.current?.messages === messages && lastAutoScrollRef.current.phase === phase) return
    lastAutoScrollRef.current = { messages, phase }
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [messages, phase])

  useLayoutEffect(() => {
    const node = promptRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`
    node.style.overflowY = node.scrollHeight > 160 ? 'auto' : 'hidden'
  }, [prompt])

  const stop = useCallback(async () => {
    turnGenerationRef.current += 1
    const abort = abortRef.current
    const stoppedTurnId = turnId
    abort?.abort()
    if (abortRef.current === abort) abortRef.current = null
    let confirmed = !stoppedTurnId && !submitting
    if (stoppedTurnId) {
      try {
        const response = await runRecoverableOperation({
          identity: { requestId: crypto.randomUUID(), gameId, generation: turnGenerationRef.current, deadlineAt: Date.now() + 10_000 },
          hardLimitMs: 10_000,
          run: (signal) => request(`/api/game-agent/turn/${encodeURIComponent(stoppedTurnId)}?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE', signal }),
        })
        confirmed = response.ok
      } catch {
        confirmed = false
      }
    }
    setSubmitting(false)
    setTurnId('')
    setPhase('')
    setQuestion('')
    return confirmed
  }, [request, turnId, gameId, submitting])

  useEffect(() => {
    const onStop = () => void stop()
    window.addEventListener('chaya:game-agent-stop', onStop)
    return () => window.removeEventListener('chaya:game-agent-stop', onStop)
  }, [stop])

  const startTurn = async (text: string) => {
    const generation = ++turnGenerationRef.current
    const assistantId = `assistant-${Date.now()}`
    assistantIdRef.current = assistantId
    eventSeqRef.current = 0
    setActivityEvents([])
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text }, { id: assistantId, role: 'assistant', text: '' }])
    setPrompt('')
    setPhase(copy.observing)
    const abort = new AbortController()
    abortRef.current = abort
    setSubmitting(true)
    try {
      const response = await request('/api/game-agent/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, sessionId: sessionId || undefined, newSession, profileId, model, mode: 'ask', prompt: text, locale }),
        signal: abort.signal,
      })
      if (!response.ok || !response.body) throw new Error(errorMessage(await response.json().catch(() => null), `HTTP ${response.status}`))
      await consumeStream(response, generation)
    } catch (error) {
      if (!abort.signal.aborted && generation === turnGenerationRef.current) {
        setMessages((current) => [...current, { id: `error-${Date.now()}`, role: 'error', text: error instanceof Error ? error.message : String(error) }])
      }
    } finally {
      if (abortRef.current === abort) abortRef.current = null
      if (generation === turnGenerationRef.current) {
        setSubmitting(false)
        void refresh()
      }
    }
  }

  /** 卡片按钮回复选项 id（不另起一条玩家消息），输入框回复原文；待答卡片一并标为已答 */
  const replyToTurn = async (reply: string, fromCard = false) => {
    if (!turnId) return
    const previousQuestion = question
    const pendingIds = messages.flatMap((message) => message.cards?.filter((entry) => entry.state === 'pending').map((entry) => entry.id) || [])
    setPrompt((current) => (fromCard ? current : ''))
    setQuestion('')
    setMessages((current) => updateCards(current, (entry) => pendingIds.includes(entry.id), { state: 'answered', answer: reply }))
    try {
      const response = await request(`/api/game-agent/turn/${encodeURIComponent(turnId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, reply, replyId: crypto.randomUUID() }),
      })
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), `HTTP ${response.status}`))
      if (!fromCard) setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text: reply }])
    } catch (error) {
      setQuestion(previousQuestion)
      setMessages((current) => [
        ...updateCards(current, (entry) => pendingIds.includes(entry.id), { state: 'pending', answer: undefined }),
        { id: `error-${Date.now()}`, role: 'error', text: error instanceof Error ? error.message : String(error) },
      ])
    }
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text || !model || (!question && (running || abortRef.current)) || !status?.available) return
    if (question && turnId) return replyToTurn(text)
    await startTurn(text)
  }

  const resize = (event: React.PointerEvent) => {
    if (variant !== 'sidebar') return
    const startX = event.clientX
    const startWidth = width
    event.currentTarget.setPointerCapture(event.pointerId)
    let nextWidth = startWidth
    const move = (next: PointerEvent) => {
      const max = Math.max(320, Math.min(560, window.innerWidth - 160))
      nextWidth = Math.max(320, Math.min(max, startWidth + startX - next.clientX))
      setWidth(nextWidth)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      localStorage.setItem('chaya.gameAgent.width', String(nextWidth))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  if (!open) return null
  return (
    <section
      className={cn('relative flex h-full min-h-0 flex-col bg-panel', variant === 'sidebar' ? 'border-l border-line shadow-[-16px_0_42px_rgb(0_0_0/0.34)]' : 'min-w-0 flex-1')}
      style={variant === 'sidebar' ? { width } : undefined}
      aria-label={copy.title}
    >
      {variant === 'sidebar' ? <div className="absolute top-0 bottom-0 left-[-4px] z-10 w-2 cursor-ew-resize" onPointerDown={resize} aria-hidden /> : null}
      <>
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3">
          <strong className="text-sm text-ink">{copy.title}</strong>
          <span className={cn('h-2 w-2 rounded-full', status?.available ? 'bg-ok' : 'bg-fail')} aria-hidden />
          {running ? <span className="text-xs font-medium text-accent">{copy.running}</span> : null}
          <div className="min-w-0 flex-1" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={copy.newSession}
            tooltip={copy.newSession}
            disabled={running}
            onClick={() => {
              setMessages([])
              setSessionId('')
              setNewSession(true)
            }}
          >
            <IoTrashOutline size={16} aria-hidden />
          </Button>
          {onClose ? (
            <Button variant="ghost" size="icon" aria-label={copy.title} tooltip={copy.title} onClick={onClose}>
              <IoCloseOutline size={17} aria-hidden />
            </Button>
          ) : null}
        </header>

        <ScrollArea className="flex-1" scrollRef={bodyRef} scrollClassName="px-4 py-4" reserveGutter={false}>
          {!status?.available ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center text-ink-soft">
              {loadingStatus ? <Spinner /> : <strong className="text-ink">{copy.unavailable}</strong>}
              <p className="m-0 max-w-70 text-xs leading-5">{status?.reason || copy.empty}</p>
              {loadingStatus || !onConnect ? null : <Button onClick={onConnect}>{copy.connect}</Button>}
            </div>
          ) : messages.length === 0 ? (
            <p className="m-0 text-sm leading-6 text-ink-soft">{copy.empty}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'max-w-[92%] whitespace-pre-wrap text-sm leading-6',
                    message.role === 'user' ? 'ml-auto rounded-md bg-accent px-3 py-2 text-accent-ink' : message.role === 'error' ? 'text-fail' : 'text-ink'
                  )}
                >
                  {message.tools?.length && !(message.id === assistantIdRef.current && activityEvents.length) ? (
                    <div className="mb-2 flex flex-col gap-1" aria-live="polite">
                      {message.tools.map((tool) => (
                        <div key={tool.id} className={cn('flex min-w-0 items-center gap-2 text-xs', tool.state === 'failed' ? 'text-fail' : 'text-ink-soft')}>
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                            {tool.state === 'running' ? (
                              <Spinner size="sm" />
                            ) : tool.state === 'completed' ? (
                              <IoCheckmark size={15} className="text-ok" />
                            ) : (
                              <IoCloseCircleOutline size={15} />
                            )}
                          </span>
                          <span className="shrink-0">{tool.state === 'running' ? copy.toolCalling : tool.state === 'completed' ? copy.toolCalled : copy.toolFailed}</span>
                          <TruncateText text={tool.name} className="font-mono text-[11px] text-ink" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.id === assistantIdRef.current && activityEvents.length ? (
                    <details key={`${message.id}-${running ? 'running' : 'done'}`} className="mb-2" open={running || undefined}>
                      <summary className="cursor-pointer text-xs text-ink-soft">{running ? '思考过程' : '查看思考过程'}</summary>
                      <div className="mt-2 border-l border-line pl-2">
                        <AgentActivityTimeline events={activityEvents} compact />
                      </div>
                    </details>
                  ) : null}
                  {message.progress?.length && !(message.id === assistantIdRef.current && activityEvents.length) ? (
                    <div className="mb-2 flex flex-col gap-1 text-xs text-ink-soft" aria-live="polite">
                      {message.progress.map((item, index) => (
                        <span key={`${index}-${item}`}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                  {message.cards?.map((entry) => (
                    <PlayerCardView key={entry.id} card={entry.card} state={entry.state} answer={entry.answer} onAnswer={(option) => void replyToTurn(option, true)} />
                  ))}
                  {message.text || (running && message.role === 'assistant' && !message.tools?.length && !message.cards?.length ? <Spinner size="sm" /> : null)}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {goal || phase || (question && !waitingCard) ? (
          <div className="shrink-0 border-t border-line-soft px-4 py-2 text-xs text-ink-soft">
            {goal ? <strong className="mr-2 text-ink">{goal}</strong> : null}
            {(!waitingCard && question) || phase}
          </div>
        ) : null}
        <form className="shrink-0 px-3 pt-1 pb-3" aria-busy={running || undefined} onSubmit={(event) => void send(event)}>
          <div className="rounded-lg border border-line bg-panel-2 px-3 pt-2 shadow-[0_6px_24px_rgb(0_0_0/0.2)] transition-colors focus-within:border-accent">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                event.stopPropagation()
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void send()
                }
              }}
              onKeyUp={(event) => event.stopPropagation()}
              placeholder={question || copy.placeholder}
              disabled={!status?.available}
              rows={1}
              className="block min-h-12 max-h-40 w-full resize-none border-0 bg-transparent py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft"
            />
            <div className="flex min-w-0 items-center gap-2 py-2">
              <div className="ml-auto flex min-w-0 max-w-full items-center gap-2">
                <GameAgentRuntimeMenu
                  profiles={status?.profiles || []}
                  profileId={profileId}
                  model={model}
                  disabled={running}
                  onChange={(nextProfileId, nextModel) => {
                    setProfileId(nextProfileId)
                    setModel(nextModel)
                  }}
                />
                {running && question ? (
                  <>
                    <Button className="rounded-full" variant="fail" size="icon" aria-label={copy.stop} tooltip={copy.stop} onClick={() => void stop()}>
                      <IoStop size={17} aria-hidden />
                    </Button>
                    <Button variant="accent" size="icon" type="submit" className="rounded-full" aria-label={copy.send} tooltip={copy.send} disabled={!prompt.trim()}>
                      <IoArrowUp size={17} aria-hidden />
                    </Button>
                  </>
                ) : running ? (
                  <Button className="rounded-full" variant="fail" size="icon" type="button" aria-label={copy.stop} tooltip={copy.stop} onClick={() => void stop()}>
                    <IoStop size={17} aria-hidden />
                  </Button>
                ) : (
                  <Button
                    variant="accent"
                    size="icon"
                    type="submit"
                    className="rounded-full"
                    aria-label={copy.send}
                    tooltip={copy.send}
                    disabled={!prompt.trim() || !status?.available || !profileId || !model}
                  >
                    <IoArrowUp size={17} aria-hidden />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
      </>
    </section>
  )
}
