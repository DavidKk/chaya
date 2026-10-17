'use client'

import { Brain, BrushCleaning, ChevronsDown, SendHorizontal, Square } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { ConfirmProvider, useConfirm } from '@/components/confirm/ConfirmProvider'
import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { MiniPanelAlert } from '@/components/game-tools/MiniPanelParts'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea } from '@/components/sk'
import type { AgentActivityEvent } from '@/lib/game-agent/activity'
import { COMPANION_CHARACTER_PROFILES, type CompanionChest, type CompanionCue, type CompanionState, CompanionTracker, companionWords } from '@/lib/game-agent/companion'
import { CONFIRM_OPTION_IDS, parsePlayerCard, type PlayerCard } from '@/lib/game-agent/player-card'
import type { AgentRoutine } from '@/lib/game-agent/runtime/types'
import { cn } from '@/lib/utils'

import { AgentActivityTimeline } from './AgentActivityTimeline'
import { AUTOPILOT_GLOW_CLASS, AutopilotGlowKeyframes } from './AutopilotGlow'
import { clearCompanionTranscript, isPersistedCompanionActivity, loadCompanionTranscript, saveCompanionTranscript } from './companion-transcript'
import { type ChatLine, CompanionChatLine } from './CompanionChatLine'
import { GameAgentRuntimeMenu } from './GameAgentRuntimeMenu'
import type { GameAgentRequest } from './GameAgentWorkspace'
import { readTurnEvents, type TurnEvent } from './turnStream'

const POLL_MS = 2_000
const MAX_MESSAGES = 200
const NEAR_BOTTOM_PX = 48
const TOUCH_TARGET = '[@media(hover:none)]:h-11 [@media(hover:none)]:w-11'
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
type Props = { gameId: string; open: boolean; observe: () => CompanionState; request: GameAgentRequest }
type RuntimeSelection = { profileId: string; model: string }
const RUNTIME_SELECTION_KEY = 'chaya.game-agent.runtime-selection'
const THINKING_KEY = 'chaya.game-agent.thinking'

function loadThinkingPreference() {
  try {
    return localStorage.getItem(THINKING_KEY) === 'true'
  } catch {
    return false
  }
}

function loadRuntimeSelection(): RuntimeSelection {
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_SELECTION_KEY) || 'null') as Partial<RuntimeSelection> | null
    return { profileId: typeof value?.profileId === 'string' ? value.profileId : '', model: typeof value?.model === 'string' ? value.model : '' }
  } catch {
    return { profileId: '', model: '' }
  }
}

function saveRuntimeSelection(selection: RuntimeSelection) {
  if (!selection.profileId || !selection.model) return
  try {
    localStorage.setItem(RUNTIME_SELECTION_KEY, JSON.stringify(selection))
  } catch {
    // Runtime state still works when storage is unavailable.
  }
}

function responseError(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

/**
 * Chat shows the structured `brief` when the turn provides one, otherwise the model's final reply.
 * Reply text is never filtered by phrases; reasoning arrives separately (thinking channel / CLI envelope).
 */
function companionReply(item: TurnEvent) {
  return (item.brief || item.text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
}

function companionViewKey(gameId: string) {
  return `chaya.companion.view.${gameId}`
}

function loadCompanionView(gameId: string): 'chat' | 'activity' {
  try {
    return localStorage.getItem(companionViewKey(gameId)) === 'activity' ? 'activity' : 'chat'
  } catch {
    return 'chat'
  }
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
  const toolSettings = useToolSettings(request)
  const { settings } = toolSettings
  const panel = useToolPanelVisibility('companion', settings.companionEnabled)
  const character = COMPANION_CHARACTER_PROFILES[settings.companionCharacter]
  const [messages, setMessages] = useState<ChatLine[]>(() => loadCompanionTranscript(gameId).messages)
  const [tab, setTab] = useState<'chat' | 'activity'>(() => loadCompanionView(gameId))
  const [activityEvents, setActivityEvents] = useState<AgentActivityEvent[]>(() => loadCompanionTranscript(gameId).activity)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [profileId, setProfileId] = useState(() => loadRuntimeSelection().profileId)
  const [model, setModel] = useState(() => loadRuntimeSelection().model)
  const [thinkingEnabled, setThinkingEnabled] = useState(loadThinkingPreference)
  const [sessionId, setSessionId] = useState('')
  const [turnId, setTurnId] = useState('')
  const [question, setQuestion] = useState('')
  const [progress, setProgress] = useState('')
  const [activeReplyId, setActiveReplyId] = useState('')
  const [clearing, setClearing] = useState(false)
  const [startingAutopilot, setStartingAutopilot] = useState(false)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const turnAbortRef = useRef<AbortController | null>(null)
  const automaticBusyRef = useRef(false)
  const tracker = useRef(new CompanionTracker())
  const listRef = useRef<HTMLDivElement>(null)
  const activityListRef = useRef<HTMLDivElement>(null)
  /** Sticky-bottom follow: on until the user scrolls up; re-enabled at bottom or via the jump control. */
  const chatStickBottomRef = useRef(true)
  const activityStickBottomRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const messagesRef = useRef<ChatLine[]>(messages)
  const running = busy || !!turnId
  /** 托管任务（含旅伴发起的托管）运行中：不能清理或换模型，只能停止 */
  const autopilot = startingAutopilot || (!!turnId && status?.session?.activeTurn?.capability === 'play')
  /** Agent 正等玩家点卡片：问题已在卡片里，回复行不再重复显示 */
  const waitingCard = messages.some((line) => line.cardTurnId && line.cardState === 'pending')

  const recordActivity = useCallback((item: TurnEvent) => {
    if (!isPersistedCompanionActivity(item.type)) return
    const { type, seq, ...data } = item
    setActivityEvents((current) => [...current.filter((event) => event.seq !== (seq || 0)), { seq: seq || current.length + 1, type, at: Date.now(), data }].slice(-200))
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
    saveRuntimeSelection({ profileId, model })
  }, [model, profileId])

  useEffect(() => {
    if (open || !panel.visible) return
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [open, panel.visible, refreshStatus])

  useEffect(() => {
    if (open || !panel.visible || !turnId) return
    const abort = new AbortController()
    void request(`/api/game-agent/turn/${encodeURIComponent(turnId)}/events?gameId=${encodeURIComponent(gameId)}&after=0`, { signal: abort.signal })
      .then(async (response) => {
        if (response.ok && response.body) await readTurnEvents(response.body, recordActivity, { signal: abort.signal })
      })
      .catch(() => {})
    return () => abort.abort()
  }, [gameId, open, panel.visible, recordActivity, request, turnId])

  const append = useCallback((line: ChatLine) => {
    messagesRef.current = [...messagesRef.current, line].slice(-MAX_MESSAGES)
    setMessages(messagesRef.current)
  }, [])

  const updateCards = useCallback((match: (line: ChatLine) => boolean, patch: Partial<ChatLine>) => {
    messagesRef.current = messagesRef.current.map((line) => (line.card && match(line) ? { ...line, ...patch } : line))
    setMessages(messagesRef.current)
  }, [])

  /** Agent 发来的卡片插在当前回复之前，回答后的文字接在卡片下方 */
  const showAgentCard = useCallback(
    (item: TurnEvent, taskId: string, replyId?: string) => {
      const card = (item.type === 'approval.required' || item.type === 'card.shown') && parsePlayerCard(item.card)
      if (!card) return false
      const reply = replyId ? messagesRef.current.find((line) => line.id === replyId && !line.text) : undefined
      if (reply) messagesRef.current = messagesRef.current.filter((line) => line !== reply)
      append({ id: crypto.randomUUID(), role: 'chaya', text: '', character: settings.companionCharacter, card, cardState: 'pending', cardTurnId: taskId })
      if (reply) append(reply)
      return true
    },
    [append, settings.companionCharacter]
  )

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
      let reply = ''
      let taskId = ''
      let carded = false
      try {
        await readTurnEvents(response.body, (item) => {
          recordActivity(item)
          if (item.type === 'turn.started') taskId = item.turnId || ''
          if (showAgentCard(item, taskId)) carded = true
          if (item.type === 'user.replied') updateCards((line) => line.cardTurnId === taskId && line.cardState === 'pending', { cardState: 'answered', cardAnswer: item.text })
          if (item.type === 'assistant.delta') reply += item.text || ''
          if (item.type === 'turn.completed' && (item.brief || item.text)) reply = companionReply(item)
        })
      } finally {
        updateCards((line) => line.cardTurnId === taskId && line.cardState === 'pending', { cardState: 'expired' })
      }
      reply = companionReply({ type: 'turn.completed', text: reply }).slice(0, 240)
      if (!reply) return
      if (replaceId && !carded) {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replaceId ? { ...line, text: reply } : line))
        setMessages(messagesRef.current)
      } else append({ id: crypto.randomUUID(), role: 'chaya', text: reply, character: settings.companionCharacter })
    },
    [append, gameId, locale, model, profileId, recordActivity, request, sessionId, settings.companionCharacter, showAgentCard, updateCards]
  )

  const offerChest = useCallback(
    (line: string, chest: CompanionChest | null) => {
      updateCards((item) => !!item.offer && item.cardState === 'pending', { cardState: 'expired' })
      const card: PlayerCard = {
        kind: 'confirm',
        text: t('companion.chestOffer'),
        options: [
          { id: CONFIRM_OPTION_IDS.yes, label: t('companion.chestAccept') },
          { id: CONFIRM_OPTION_IDS.no, label: t('companion.chestDecline') },
        ],
      }
      append({
        id: crypto.randomUUID(),
        role: 'chaya',
        text: line,
        character: settings.companionCharacter,
        ...(chest ? { offer: chest, card, cardState: 'pending' as const } : {}),
      })
    },
    [append, settings.companionCharacter, t, updateCards]
  )

  useEffect(() => {
    if (open || !panel.visible) return
    const poll = () => {
      try {
        if (running || automaticBusyRef.current) return
        const cue = tracker.current.observe(observe())
        if (!cue) return
        const fallback = companionWords(locale).lines[settings.companionCharacter][cue]
        // 托管不经模型，没配好 Agent 也能提出
        if (cue === 'chest') return offerChest(fallback, tracker.current.lastChest)
        if (!status?.available || !profileId || !model) return
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
  }, [ask, append, locale, model, observe, offerChest, open, panel.visible, profileId, running, settings.companionCharacter, status?.available])

  const stickRefFor = useCallback((kind: 'chat' | 'activity') => (kind === 'chat' ? chatStickBottomRef : activityStickBottomRef), [])

  const isNearBottom = useCallback((element: HTMLDivElement) => element.scrollHeight - element.clientHeight - element.scrollTop <= NEAR_BOTTOM_PX, [])

  const pinScrollToBottom = useCallback((element: HTMLDivElement) => {
    element.scrollTop = element.scrollHeight
  }, [])

  const updateScrollPosition = useCallback(
    (element: HTMLDivElement, kind: 'chat' | 'activity') => {
      const nearBottom = isNearBottom(element)
      stickRefFor(kind).current = nearBottom
      if (kind === tab) setShowScrollToBottom(!nearBottom)
    },
    [isNearBottom, stickRefFor, tab]
  )

  useEffect(() => {
    const kind = tab
    const element = kind === 'chat' ? listRef.current : activityListRef.current
    if (!element) return

    const followIfStuck = () => {
      if (!stickRefFor(kind).current) {
        setShowScrollToBottom(!isNearBottom(element))
        return
      }
      pinScrollToBottom(element)
      setShowScrollToBottom(false)
    }

    followIfStuck()
    const frame = window.requestAnimationFrame(followIfStuck)
    const resize = new ResizeObserver(followIfStuck)
    resize.observe(element)
    const mutate = new MutationObserver(followIfStuck)
    mutate.observe(element, { childList: true, subtree: true, characterData: true })
    return () => {
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutate.disconnect()
    }
  }, [activityEvents, isNearBottom, messages, pinScrollToBottom, progress, question, stickRefFor, tab])

  const scrollToBottom = useCallback(() => {
    const element = tab === 'chat' ? listRef.current : activityListRef.current
    if (!element) return
    stickRefFor(tab).current = true
    setShowScrollToBottom(false)
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    window.setTimeout(() => {
      if (!stickRefFor(tab).current) return
      pinScrollToBottom(element)
    }, 320)
  }, [pinScrollToBottom, stickRefFor, tab])

  useEffect(() => {
    saveCompanionTranscript(gameId, { messages, activity: activityEvents })
  }, [activityEvents, gameId, messages])

  useEffect(() => {
    try {
      localStorage.setItem(companionViewKey(gameId), tab)
    } catch {
      // The current session state still works when storage is unavailable.
    }
  }, [gameId, tab])

  useEffect(() => {
    setTab(loadCompanionView(gameId))
  }, [gameId])

  const consumeTurn = async (response: Response, replyId: string, signal?: AbortSignal) => {
    if (!response.ok || !response.body) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let taskId = ''
    const apply = (item: TurnEvent) => {
      recordActivity(item)
      if (showAgentCard(item, taskId, replyId) && item.type === 'card.shown') return
      if (item.type === 'turn.started') {
        taskId = item.turnId || ''
        setTurnId(taskId)
        setSessionId(item.sessionId || '')
      } else if (item.type === 'assistant.delta') {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replyId ? { ...line, text: line.text + (item.text || '') } : line))
        setMessages(messagesRef.current)
      } else if (item.type === 'turn.completed' && (item.brief || item.text)) {
        messagesRef.current = messagesRef.current.map((line) => (line.id === replyId ? { ...line, text: companionReply(item) } : line))
        setMessages(messagesRef.current)
      } else if (item.type === 'approval.required') {
        setQuestion(item.question || '')
        setProgress('')
      } else if (item.type === 'user.replied') {
        updateCards((line) => line.cardTurnId === taskId && line.cardState === 'pending', { cardState: 'answered', cardAnswer: item.text })
        setQuestion('')
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
        updateCards((line) => line.cardTurnId === taskId && line.cardState === 'pending', { cardState: 'expired' })
        setTurnId('')
        setQuestion('')
        setProgress('')
      }
    }
    try {
      await readTurnEvents(response.body, apply, {
        signal,
        onReader: (next) => {
          reader = next
          readerRef.current = next
        },
      })
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
      messagesRef.current = []
      setMessages([])
      setActivityEvents([])
      clearCompanionTranscript(gameId)
      append({ id: crypto.randomUUID(), role: 'chaya', text: t('companion.cleared'), character: settings.companionCharacter })
    } catch (error) {
      append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setClearing(false)
    }
  }

  const stop = async () => {
    if (!turnId) {
      turnAbortRef.current?.abort(new DOMException('Stopped', 'AbortError'))
      void readerRef.current?.cancel().catch(() => {})
      turnAbortRef.current = null
      setBusy(false)
      setStartingAutopilot(false)
      setProgress('')
      return
    }
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
    if (!text || (running && !question && !waitingCard)) return
    setDraft('')
    append({ id: crypto.randomUUID(), role: 'player', text })
    if (waitingCard && turnId) {
      // Typed input is a new request, not a card answer. Expire the old card
      // and stop its waiting task before starting the new conversation turn.
      const waitingTurnId = turnId
      updateCards((line) => line.cardTurnId === waitingTurnId && line.cardState === 'pending', { cardState: 'expired' })
      setQuestion('')
      setTurnId('')
      void readerRef.current?.cancel().catch(() => {})
      try {
        await request(`/api/game-agent/turn/${encodeURIComponent(waitingTurnId)}?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' })
      } catch {
        // The new request can still proceed; the old task will be reaped by the host.
      }
    }
    await startTurn(text)
  }

  /** 回答 Agent 的等待：卡片按钮回复选项 id，输入框回复原文；待答卡片一并标为已答 */
  const replyToTask = async (taskId: string, reply: string) => {
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
      if (!response.ok) throw new Error(responseError(await response.json().catch(() => null), `HTTP ${response.status}`))
      setProgress(t('companion.thinking'))
    } catch (error) {
      updateCards((line) => waiting.includes(line.id), { cardState: 'pending', cardAnswer: undefined })
      setQuestion(previousQuestion)
      append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const startTurn = async (prompt: string, routine?: AgentRoutine) => {
    setBusy(true)
    setStartingAutopilot(!!routine)
    const replyId = crypto.randomUUID()
    setActiveReplyId(replyId)
    setProgress(t('companion.thinking'))
    append({ id: replyId, role: 'chaya', text: '', character: settings.companionCharacter })
    const abort = new AbortController()
    turnAbortRef.current = abort
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
            thinking: thinkingEnabled,
            prompt,
            locale,
            ...(routine ? { routine } : {}),
          }),
          signal: abort.signal,
        }),
        replyId,
        abort.signal
      )
    } catch (error) {
      messagesRef.current = messagesRef.current.filter((line) => line.id !== replyId || !!line.text)
      setMessages(messagesRef.current)
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        append({ id: crypto.randomUUID(), role: 'error', text: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (turnAbortRef.current === abort) turnAbortRef.current = null
      setBusy(false)
      setStartingAutopilot(false)
      setActiveReplyId('')
      setProgress('')
      void refreshStatus()
    }
  }

  const answerCard = (line: ChatLine, optionId: string) => {
    if (line.cardState !== 'pending') return
    const chest = line.offer
    if (!chest) {
      if (line.cardTurnId) void replyToTask(line.cardTurnId, optionId)
      return
    }
    if (running) return
    updateCards((item) => item.id === line.id, { cardState: 'answered', cardAnswer: optionId })
    if (optionId === CONFIRM_OPTION_IDS.yes) void startTurn(t('companion.chestGoal', { x: chest.x, y: chest.y }), { kind: 'chest', ...chest })
  }

  if (open || !panel.visible) return null
  const activityVisible = tab === 'activity'
  const viewLabel = t(activityVisible ? 'companion.showChat' : 'companion.showActivity')
  const viewToggle = (
    <Button
      size="mini"
      variant="plain"
      className={cn(TOUCH_TARGET, activityVisible && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
      aria-label={viewLabel}
      aria-pressed={activityVisible}
      tooltip={viewLabel}
      onClick={() => setTab(activityVisible ? 'chat' : 'activity')}
    >
      <Brain size={13} aria-hidden />
    </Button>
  )
  return (
    <FloatingToolPanel
      title={character.name}
      headerTools={
        <>
          {autopilot ? <AutopilotGlowKeyframes /> : null}
          {viewToggle}
          <Button
            size="mini"
            variant="plain"
            className={TOUCH_TARGET}
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
            thinkingEnabled={thinkingEnabled}
            onThinkingChange={(next) => {
              setThinkingEnabled(next)
              try {
                localStorage.setItem(THINKING_KEY, String(next))
              } catch {
                // The preference still applies for this session when storage is unavailable.
              }
            }}
            disabled={running}
            onChange={(nextProfile, nextModel) => {
              setProfileId(nextProfile)
              setModel(nextModel)
            }}
          />
        </>
      }
      opacity={toolSettings}
      onClose={panel.dismiss}
      panel="companion"
      scrollContent={false}
    >
      <div className="relative flex h-full min-h-0 flex-col">
        <MiniPanelAlert>{status && !status.available ? status.reason || t('companion.unavailable') : null}</MiniPanelAlert>
        {tab === 'chat' ? (
          <ScrollArea
            className="min-h-0 flex-1"
            scrollRef={listRef}
            scrollClassName="px-2 py-2"
            reserveGutter={false}
            scrollProps={{
              id: 'companion-chat',
              role: 'tabpanel',
              'aria-label': t('companion.conversationAria'),
              'aria-live': 'polite',
              onScroll: (event) => updateScrollPosition(event.currentTarget, 'chat'),
            }}
          >
            {messages.map((line) => (
              <CompanionChatLine
                key={line.id}
                line={line}
                character={settings.companionCharacter}
                pending={line.id === activeReplyId && running && !waitingCard ? { question, progress } : null}
                offerLocked={running}
                onAnswer={answerCard}
              />
            ))}
          </ScrollArea>
        ) : (
          <ScrollArea
            className="min-h-0 flex-1"
            scrollRef={activityListRef}
            scrollClassName="px-2 py-2"
            reserveGutter={false}
            scrollProps={{ id: 'companion-activity', role: 'tabpanel', onScroll: (event) => updateScrollPosition(event.currentTarget, 'activity') }}
          >
            <AgentActivityTimeline events={activityEvents} compact />
          </ScrollArea>
        )}
        {showScrollToBottom ? (
          <div
            role="button"
            tabIndex={0}
            className="absolute right-0 bottom-6 left-0 z-[5] h-4 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent [@media(hover:none)]:bottom-9"
            aria-label={t('companion.scrollToBottom')}
            onClick={scrollToBottom}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                scrollToBottom()
              }
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-1/2 h-8 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--accent)_48%,transparent),transparent)] opacity-80 blur-sm"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color-mix(in_oklab,var(--accent)_82%,transparent)] shadow-[0_-3px_12px_2px_var(--accent-glow)]"
            />
            <ChevronsDown
              size={18}
              strokeWidth={2.5}
              className="absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 text-accent drop-shadow-[0_0_6px_var(--accent-glow)] motion-safe:animate-pulse motion-reduce:animate-none"
              aria-hidden
            />
          </div>
        ) : null}
        <form className="flex h-8 shrink-0 items-stretch border-t border-line bg-inset [@media(hover:none)]:h-11" onSubmit={(event) => void send(event)}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            maxLength={500}
            disabled={autopilot}
            aria-label={t('companion.inputAria')}
            placeholder={question || t(autopilot ? 'companion.autopilotPlaceholder' : 'companion.placeholder')}
            className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[11px] text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          />
          {running && !question ? (
            <Button
              type="button"
              variant="plain"
              size="icon"
              className="h-8 w-8 shrink-0 overflow-visible text-fail hover:enabled:text-fail [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
              aria-label={autopilot ? t('companion.autopilotStop') : t('companion.stop')}
              tooltip={autopilot ? t('companion.autopilotStop') : t('companion.stop')}
              disabled={!running}
              onClick={() => void stop()}
            >
              <Square size={autopilot ? 12 : 13} fill="currentColor" aria-hidden className={autopilot && turnId ? AUTOPILOT_GLOW_CLASS : undefined} />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="accent"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-none [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
              aria-label={t('companion.send')}
              tooltip={t('companion.send')}
              disabled={autopilot || !draft.trim() || (!question && (!status?.available || !profileId || !model))}
            >
              <SendHorizontal size={14} aria-hidden />
            </Button>
          )}
        </form>
      </div>
    </FloatingToolPanel>
  )
}
