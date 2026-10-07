'use client'

import { SendHorizontal, Square } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { MiniPanelAlert } from '@/components/game-tools/MiniPanelParts'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea, Spinner } from '@/components/sk'
import { COMPANION_CHARACTER_PROFILES, type CompanionCharacter, type CompanionCue, type CompanionState, CompanionTracker, companionWords } from '@/lib/game-agent/companion'

import { GameAgentRuntimeMenu } from './GameAgentRuntimeMenu'
import type { GameAgentRequest } from './GameAgentWorkspace'

const POLL_MS = 2_000
const MAX_MESSAGES = 30

type ChatLine = { id: string; role: 'chaya' | 'player' | 'error'; text: string; character?: CompanionCharacter }
type AgentProfile = { id: string; label: string; online: boolean; models: { name: string }[]; defaultModel: string }
type AgentStatus = { available: boolean; profiles: AgentProfile[]; defaultProfileId: string; session: { id: string } | null; reason: string | null }
type TurnEvent = { type: string; turnId?: string; sessionId?: string; text?: string; message?: string; question?: string; name?: string; phase?: string }
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

function snapshot(state: CompanionState) {
  return {
    scene: state.scene,
    map: state.map,
    party: state.party?.slice(0, 8),
    battle: state.battle,
    nearbyEvents: state.nearbyEvents
      ?.filter((event) => event.distance != null && event.distance <= 8)
      .slice(0, 12)
      .map(({ name, distance }) => ({ name, distance })),
  }
}

export function CompanionPanel({ gameId, open, observe, request }: Props) {
  const locale = useLocaleCode()
  const t = useT()
  const { settings } = useToolSettings(request)
  const panel = useToolPanelVisibility('companion', settings.companionEnabled)
  const character = COMPANION_CHARACTER_PROFILES[settings.companionCharacter]
  const [messages, setMessages] = useState<ChatLine[]>([])
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
  const tracker = useRef(new CompanionTracker())
  const listRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<ChatLine[]>([])

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
    } catch (error) {
      setStatus({ available: false, profiles: [], defaultProfileId: '', session: null, reason: error instanceof Error ? error.message : String(error) })
    }
  }, [gameId, profileId, request, sessionId])

  useEffect(() => {
    if (!open) void refreshStatus()
  }, [open, refreshStatus])

  const append = useCallback((line: ChatLine) => {
    messagesRef.current = [...messagesRef.current, line].slice(-MAX_MESSAGES)
    setMessages(messagesRef.current)
  }, [])

  const ask = useCallback(
    async (text: string, cue?: CompanionCue, replaceId?: string) => {
      const response = await request('/api/game-agent/companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          cue,
          locale,
          character: settings.companionCharacter,
          profileId: profileId || undefined,
          model: model || undefined,
          state: snapshot(observe()),
          history: messagesRef.current.slice(-8).map(({ role, text: content }) => ({ role, content })),
        }),
      })
      const body = (await response.json()) as { text?: string; error?: { message?: string } }
      if (!response.ok || !body.text?.trim()) throw new Error(body.error?.message || `HTTP ${response.status}`)
      const reply = body.text.trim().slice(0, 240)
      if (replaceId) {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replaceId ? { ...line, text: reply } : line))
        setMessages(messagesRef.current)
      } else append({ id: crypto.randomUUID(), role: 'chaya', text: reply, character: settings.companionCharacter })
    },
    [append, locale, model, observe, profileId, request, settings.companionCharacter]
  )

  useEffect(() => {
    if (open || !panel.visible) return
    const poll = () => {
      try {
        const cue = tracker.current.observe(observe())
        if (!cue) return
        const fallback = companionWords(locale).lines[settings.companionCharacter][cue]
        const id = crypto.randomUUID()
        append({ id, role: 'chaya', text: fallback, character: settings.companionCharacter })
        void ask('', cue, id).catch(() => {})
      } catch {
        // The game may be loading a new scene.
      }
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(timer)
  }, [ask, append, locale, observe, open, panel.visible, settings.companionCharacter])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, progress])

  const consumeTurn = async (response: Response, replyId: string) => {
    if (!response.ok || !response.body) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const apply = (item: TurnEvent) => {
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
        setProgress(t('companion.acting'))
      } else if (item.type === 'phase') {
        const phase = { observing: 'companion.observing', thinking: 'companion.thinking', acting: 'companion.acting', verifying: 'companion.verifying' } as const
        setProgress(item.phase === 'waiting_user' ? '' : t(phase[item.phase as keyof typeof phase] ?? 'companion.thinking'))
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
  }

  const stop = async () => {
    if (!turnId) return
    try {
      await request(`/api/game-agent/turn/${encodeURIComponent(turnId)}?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' })
    } catch (error) {
      append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || (busy && !question)) return
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
        <GameAgentRuntimeMenu
          compact
          profiles={status?.profiles || []}
          profileId={profileId}
          model={model}
          disabled={busy}
          onChange={(nextProfile, nextModel) => {
            setProfileId(nextProfile)
            setModel(nextModel)
          }}
        />
      }
      onClose={panel.dismiss}
      panel="companion"
      scrollContent={false}
    >
      <div className="flex h-full min-h-0 flex-col">
        <MiniPanelAlert>{status && !status.available ? status.reason || t('companion.unavailable') : null}</MiniPanelAlert>
        <ScrollArea
          className="min-h-0 flex-1"
          scrollRef={listRef}
          scrollClassName="px-2 py-2"
          reserveGutter={false}
          scrollProps={{ 'aria-label': t('companion.conversationAria'), 'aria-live': 'polite' }}
        >
          {messages.map((line) => (
            <p key={line.id} className="m-0 mb-1 break-words text-[11px] leading-4 text-ink last:mb-0">
              <strong className={line.role === 'error' ? 'text-fail' : line.role === 'player' ? 'text-accent' : 'text-ink'}>
                {line.role === 'chaya' ? COMPANION_CHARACTER_PROFILES[line.character || settings.companionCharacter].name : line.role === 'player' ? 'Player' : '!'}:
              </strong>{' '}
              {line.text ||
                (line.id === activeReplyId && busy
                  ? question || (
                      <span className="text-ink-soft">
                        <Spinner size="sm" className="mr-1 inline-block align-middle" label={progress || 'Thinking'} />
                        {progress || '…'}
                      </span>
                    )
                  : null)}
            </p>
          ))}
        </ScrollArea>
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
          {busy && !question ? (
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
