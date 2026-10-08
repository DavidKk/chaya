'use client'

import { BrushCleaning, SendHorizontal, Square } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { ConfirmProvider, useConfirm } from '@/components/confirm/ConfirmProvider'
import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { MiniPanelAlert, MiniPanelBar } from '@/components/game-tools/MiniPanelParts'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea, SegmentedNav, Spinner } from '@/components/sk'
import type { AgentActivityEvent } from '@/lib/game-agent/activity'
import { COMPANION_CHARACTER_PROFILES, type CompanionCharacter, type CompanionCue, type CompanionState, CompanionTracker, companionWords } from '@/lib/game-agent/companion'

import { AgentActivityTimeline } from './AgentActivityTimeline'
import { GameAgentRuntimeMenu } from './GameAgentRuntimeMenu'
import type { GameAgentRequest } from './GameAgentWorkspace'

const POLL_MS = 2_000
const MAX_MESSAGES = 30
const COMPANION_TABS = [
  { id: 'chat' as const, label: '聊天', panelId: 'companion-chat' },
  { id: 'activity' as const, label: '思考过程', panelId: 'companion-activity' },
]

type ChatLine = { id: string; role: 'chaya' | 'player' | 'error'; text: string; character?: CompanionCharacter }
type AgentProfile = { id: string; label: string; online: boolean; models: { name: string }[]; defaultModel: string }
type AgentStatus = {
  available: boolean
  profiles: AgentProfile[]
  defaultProfileId: string
  session: { id: string; activeTurnId?: string | null; activeTurn?: { id: string; state: string; goal?: string; phase?: string } | null } | null
  reason: string | null
}
type TurnEvent = {
  type: string
  seq?: number
  turnId?: string
  sessionId?: string
  text?: string
  message?: string
  question?: string
  name?: string
  phase?: string
  summary?: string
  step?: number
  maxSteps?: number
  callId?: string
  ok?: boolean
  durationMs?: number
  input?: Record<string, unknown>
  output?: unknown
  usage?: unknown
  content?: string
  role?: string
}
type Props = { gameId: string; open: boolean; observe: () => CompanionState; request: GameAgentRequest }

function responseError(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

function companionReply(text: string) {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const hasSummary = lines.some((line) => line.startsWith('剧情摘要：'))
  const hasBattleResult = lines.some((line) => line.startsWith('本场战斗结果：'))
  if (!hasSummary && !hasBattleResult) return text.trim()
  return lines
    .filter((line) => !line.startsWith('记录到的剧情：') || (!hasSummary && !hasBattleResult))
    .map((line) => line.replace(/^剧情摘要：/, ''))
    .join(' ')
}

/** 局内 Agent 浮层的 React 根没有确认框，这里自带一份并挂进同一个 Shadow 根 */
export function CompanionPanel(props: Props) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return (
    <ConfirmProvider portalContainer={portal}>
      <CompanionPanelBody {...props} />
      <div ref={setPortal} />
    </ConfirmProvider>
  )
}

function CompanionPanelBody({ gameId, open, observe, request }: Props) {
  const locale = useLocaleCode()
  const t = useT()
  const confirm = useConfirm()
  const { settings } = useToolSettings(request)
  const panel = useToolPanelVisibility('companion', settings.companionEnabled)
  const character = COMPANION_CHARACTER_PROFILES[settings.companionCharacter]
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [tab, setTab] = useState<'chat' | 'activity'>('chat')
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [profileId, setProfileId] = useState('')
  const [model, setModel] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [turnId, setTurnId] = useState('')
  const [question, setQuestion] = useState('')
  const [progress, setProgress] = useState('')
  const [activeReplyId, setActiveReplyId] = useState('')
  const [clearing, setClearing] = useState(false)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const activityTaskRef = useRef('')
  const automaticBusyRef = useRef(false)
  const tracker = useRef(new CompanionTracker())
  const listRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<ChatLine[]>([])
  const running = busy || !!turnId

  const recordActivity = useCallback((item: TurnEvent) => {
    if (!['phase', 'thought.updated', 'tool.started', 'tool.completed', 'progress.updated', 'model.completed', 'persistence.degraded'].includes(item.type)) return
    const { type, seq, ...data } = item
    setActivityEvents((current) => [...current.filter((event) => event.seq !== (seq || 0)), { seq: seq || current.length + 1, type, data }].slice(-200))
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const response = await request(`/api/game-agent/status?gameId=${encodeURIComponent(gameId)}`)
      const body = (await response.json()) as AgentStatus
      if (!response.ok) throw new Error(responseError(body, `HTTP ${response.status}`))
      setStatus(body)
      const nextId = body.profiles.some((profile) => profile.id === profileId) ? profileId : body.defaultProfileId
      const nextProfile = body.profiles.find((profile) => profile.id === nextId)
      setProfileId(nextId)
      setModel((current) => (nextProfile?.models.some((item) => item.name === current) ? current : nextProfile?.defaultModel || ''))
      if (!sessionId) setSessionId(body.session?.id || '')
      const active = body.session?.activeTurn
      if (active) {
        setTurnId(active.id)
        if (!readerRef.current) setProgress(active.phase || t('companion.running'))
      } else if (!readerRef.current) {
        setTurnId('')
        setProgress('')
      }
    } catch (error) {
      setStatus({ available: false, profiles: [], defaultProfileId: '', session: null, reason: error instanceof Error ? error.message : String(error) })
    }
  }, [gameId, profileId, request, sessionId, t])

  useEffect(() => {
    if (open || !panel.visible) return
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, panel.visible, refreshStatus])

  useEffect(() => {
    if (open || !panel.visible || !turnId) return
    if (activityTaskRef.current !== turnId) {
      activityTaskRef.current = turnId
      setActivityEvents([])
    }
    const abort = new AbortController()
    void request(`/api/game-agent/turn/${encodeURIComponent(turnId)}/events?gameId=${encodeURIComponent(gameId)}&after=0`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok || !response.body) return
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''
          for (const chunk of chunks) {
            const data = chunk
              .split(/\r?\n/)
              .find((line) => line.startsWith('data:'))
              ?.slice(5)
              .trim()
            if (data) recordActivity(JSON.parse(data) as TurnEvent)
          }
        }
      })
      .catch(() => {})
    return () => abort.abort()
  }, [gameId, open, panel.visible, recordActivity, request, turnId])

  const append = useCallback((line: ChatLine) => {
    messagesRef.current = [...messagesRef.current, line].slice(-MAX_MESSAGES)
    setMessages(messagesRef.current)
  }, [])

  const ask = useCallback(
    async (text: string, cue?: CompanionCue, replaceId?: string) => {
      const response = await request('/api/game-agent/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          sessionId: sessionId || undefined,
          prompt: text || `根据当前游戏状态给一句简短的陪玩回应。触发场景：${cue || '观察'}`,
          locale,
          surface: 'companion',
          companionCharacter: settings.companionCharacter,
          profileId: profileId || undefined,
          model: model || undefined,
        }),
      })
      if (!response.ok || !response.body) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reply = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const data = chunk
            .split(/\r?\n/)
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
            .trim()
          if (!data) continue
          const item = JSON.parse(data) as TurnEvent
          recordActivity(item)
          if (item.type === 'assistant.delta') reply += item.text || ''
          if (item.type === 'turn.completed' && item.text) reply = item.text
        }
      }
      reply = companionReply(reply).trim().slice(0, 240)
      if (!reply) return
      if (replaceId) {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replaceId ? { ...line, text: reply } : line))
        setMessages(messagesRef.current)
      } else append({ id: crypto.randomUUID(), role: 'chaya', text: reply, character: settings.companionCharacter })
    },
    [append, gameId, locale, model, profileId, recordActivity, request, sessionId, settings.companionCharacter]
  )

  useEffect(() => {
    if (open || !panel.visible) return
    const poll = () => {
      try {
        if (running || automaticBusyRef.current || !status?.available || !profileId || !model) return
        const cue = tracker.current.observe(observe())
        if (!cue) return
        const fallback = companionWords(locale).lines[settings.companionCharacter][cue]
        const id = crypto.randomUUID()
        append({ id, role: 'chaya', text: fallback, character: settings.companionCharacter })
        automaticBusyRef.current = true
        void ask('', cue, id)
          .catch(() => {})
          .finally(() => {
            automaticBusyRef.current = false
          })
      } catch {
        // The game may be loading a new scene.
      }
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(timer)
  }, [ask, append, locale, model, observe, open, panel.visible, profileId, running, settings.companionCharacter, status?.available])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, progress])

  const consumeTurn = async (response: Response, replyId: string) => {
    if (!response.ok || !response.body) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
    const reader = response.body.getReader()
    readerRef.current = reader
    const decoder = new TextDecoder()
    let buffer = ''
    const apply = (item: TurnEvent) => {
      recordActivity(item)
      if (item.type === 'turn.started') {
        setTurnId(item.turnId || '')
        setSessionId(item.sessionId || '')
      } else if (item.type === 'assistant.delta') {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replyId ? { ...line, text: line.text + (item.text || '') } : line))
        setMessages(messagesRef.current)
      } else if (item.type === 'turn.completed' && item.text) {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replyId ? { ...line, text: companionReply(item.text || '') } : line))
        setMessages(messagesRef.current)
      } else if (item.type === 'approval.required') {
        setQuestion(item.question || '')
        setProgress('')
      } else if (item.type === 'tool.started') {
        setProgress(item.name ? `${t('companion.acting')} ${item.name}` : t('companion.acting'))
      } else if (item.type === 'phase') {
        const phase = { observing: 'companion.observing', thinking: 'companion.thinking', acting: 'companion.acting', verifying: 'companion.verifying' } as const
        const label = item.phase === 'waiting_user' ? '' : t(phase[item.phase as keyof typeof phase] ?? 'companion.thinking')
        setProgress(label && item.step && item.maxSteps ? `${label} ${item.step}/${item.maxSteps}` : label)
      } else if (item.type === 'progress.updated') {
        setProgress(item.summary || t('companion.running'))
      } else if (item.type === 'turn.failed') {
        messagesRef.current = messagesRef.current.filter((line) => line.id !== replyId || !!line.text)
        setMessages(messagesRef.current)
        append({ id: crypto.randomUUID(), role: 'error', text: item.message || t('companion.failed') })
      } else if (item.type === 'turn.stopped') {
        messagesRef.current = messagesRef.current.filter((line) => line.id !== replyId || !!line.text)
        setMessages(messagesRef.current)
      }
      if (item.type === 'turn.completed' || item.type === 'turn.stopped' || item.type === 'turn.failed') {
        setTurnId('')
        setQuestion('')
        setProgress('')
      }
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const data = chunk
            .split(/\r?\n/)
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
            .trim()
          if (data) apply(JSON.parse(data) as TurnEvent)
        }
      }
    } finally {
      if (readerRef.current === reader) readerRef.current = null
    }
  }

  /** 一键清理：解除服务端 AGENT_TURN_RUNNING，并断开本地卡住的流；会连侧栏的任务一起停，先确认 */
  const clearTasks = async () => {
    if (clearing) return
    const approved = await confirm({
      title: t('companion.clearConfirmTitle'),
      description: t('companion.clearConfirmDesc'),
      confirmLabel: t('companion.clearConfirm'),
      confirmVariant: 'fail',
    })
    if (!approved) return
    setClearing(true)
    try {
      const response = await request(`/api/game-agent/turn?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
      void readerRef.current?.cancel().catch(() => {})
      setTurnId('')
      setQuestion('')
      setProgress('')
      messagesRef.current = messagesRef.current.filter((line) => line.role !== 'chaya' || !!line.text)
      append({ id: crypto.randomUUID(), role: 'chaya', text: t('companion.cleared'), character: settings.companionCharacter })
    } catch (error) {
      append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setClearing(false)
    }
  }

  const stop = async () => {
    if (!turnId) return
    try {
      await request(`/api/game-agent/turn/${encodeURIComponent(turnId)}?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' })
    } catch (error) {
      append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      void refreshStatus()
    }
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || (running && !question)) return
    setDraft('')
    append({ id: crypto.randomUUID(), role: 'player', text })
    if (question && turnId) {
      setQuestion('')
      try {
        const response = await request(`/api/game-agent/turn/${encodeURIComponent(turnId)}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, reply: text, replyId: crypto.randomUUID() }),
        })
        if (!response.ok) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
        setProgress(t('companion.thinking'))
      } catch (error) {
        setQuestion(question)
        append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    setBusy(true)
    const replyId = crypto.randomUUID()
    setActiveReplyId(replyId)
    setProgress(t('companion.thinking'))
    append({ id: replyId, role: 'chaya', text: '', character: settings.companionCharacter })
    try {
      await consumeTurn(
        await request('/api/game-agent/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId,
            sessionId: sessionId || undefined,
            profileId,
            model,
            mode: 'ask',
            surface: 'companion',
            companionCharacter: settings.companionCharacter,
            prompt: text,
            locale,
          }),
        }),
        replyId
      )
    } catch (error) {
      messagesRef.current = messagesRef.current.filter((line) => line.id !== replyId || !!line.text)
      setMessages(messagesRef.current)
      append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
      setActiveReplyId('')
      setProgress('')
      void refreshStatus()
    }
  }

  if (open || !panel.visible) return null
  return (
    <FloatingToolPanel
      title={character.name}
      headerTools={
        <>
          <Button
            size="mini"
            variant="plain"
            className="[@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
            aria-label={t('companion.clear')}
            tooltip={t('companion.clear')}
            loading={clearing}
            onClick={() => void clearTasks()}
          >
            <BrushCleaning size={13} aria-hidden />
          </Button>
          <GameAgentRuntimeMenu
            compact
            profiles={status?.profiles || []}
            profileId={profileId}
            model={model}
            disabled={running}
            onChange={(nextProfile, nextModel) => {
              setProfileId(nextProfile)
              setModel(nextModel)
            }}
          />
        </>
      }
      onClose={panel.dismiss}
      panel="companion"
      scrollContent={false}
    >
      <div className="flex h-full min-h-0 flex-col">
        <MiniPanelAlert>{status && !status.available ? status.reason || t('companion.unavailable') : null}</MiniPanelAlert>
        {running ? <MiniPanelBar summary={`${t('companion.running')} · ${progress || t('companion.thinking')}`} /> : null}
        <div className="shrink-0 border-b border-line-soft px-2 py-1">
          <SegmentedNav items={COMPANION_TABS} value={tab} onChange={setTab} aria-label="陪玩面板内容" className="h-7" />
        </div>
        {tab === 'chat' ? (
          <ScrollArea
            className="min-h-0 flex-1"
            scrollRef={listRef}
            scrollClassName="px-2 py-2"
            reserveGutter={false}
            scrollProps={{ id: 'companion-chat', role: 'tabpanel', 'aria-label': t('companion.conversationAria'), 'aria-live': 'polite' }}
          >
            {messages.map((line) => (
              <p key={line.id} className="m-0 mb-1 break-words text-[11px] leading-4 text-ink last:mb-0">
                <strong className={line.role === 'error' ? 'text-fail' : line.role === 'player' ? 'text-accent' : 'text-ink'}>
                  {line.role === 'chaya' ? COMPANION_CHARACTER_PROFILES[line.character || settings.companionCharacter].name : line.role === 'player' ? t('companion.player') : '!'}:
                </strong>{' '}
                {line.text ||
                  (line.id === activeReplyId && running
                    ? question || (
                        <span className="text-ink-soft">
                          <Spinner size="sm" className="mr-1 inline-block align-middle" label={progress || t('companion.thinking')} />
                          {progress || '…'}
                        </span>
                      )
                    : null)}
              </p>
            ))}
          </ScrollArea>
        ) : (
          <ScrollArea className="min-h-0 flex-1" scrollClassName="px-2 py-2" reserveGutter={false} scrollProps={{ id: 'companion-activity', role: 'tabpanel' }}>
            <AgentActivityTimeline events={activityEvents} compact />
          </ScrollArea>
        )}
        <form className="flex h-8 shrink-0 items-stretch border-t border-line bg-inset [@media(hover:none)]:h-11" onSubmit={(event) => void send(event)}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            maxLength={500}
            aria-label={t('companion.inputAria')}
            placeholder={question || t('companion.placeholder')}
            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[11px] text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          />
          {running && !question ? (
            <Button
              type="button"
              variant="plain"
              size="icon"
              className="h-8 w-8 shrink-0 [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
              aria-label={t('companion.stop')}
              tooltip={t('companion.stop')}
              disabled={!turnId}
              onClick={() => void stop()}
            >
              <Square size={13} fill="currentColor" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="accent"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-none [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
              aria-label={t('companion.send')}
              tooltip={t('companion.send')}
              disabled={!draft.trim() || (!question && (!status?.available || !profileId || !model))}
            >
              <SendHorizontal size={14} aria-hidden />
            </Button>
          )}
        </form>
      </div>
    </FloatingToolPanel>
  )
}
