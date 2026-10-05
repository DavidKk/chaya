'use client'

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { IoCloseOutline, IoRefreshOutline, IoSend, IoSettingsOutline, IoStop, IoTrashOutline } from 'react-icons/io5'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { Button, Select, Spinner } from '@/components/sk'
import { cn } from '@/lib/utils'

import { GameAgentSettingsPanel } from './GameAgentSettingsPanel'

type Model = { name: string }
type AgentProfile = {
  id: string
  label: string
  provider: string
  online: boolean
  models: Model[]
  defaultModel: string
  reason: string | null
}
type Status = {
  available: boolean
  gameOnline: boolean
  profiles: AgentProfile[]
  defaultProfileId: string
  session: { id: string; profileId: string; activeTurnId: string | null } | null
  reason: string | null
}
type Message = { id: string; role: 'user' | 'assistant' | 'error'; text: string }

type Copy = {
  title: string
  placeholder: string
  empty: string
  retry: string
  stop: string
  newSession: string
  send: string
  settings: string
  profile: string
  model: string
  observing: string
  thinking: string
  unavailable: string
}

const COPY: Record<string, Copy> = {
  zh: {
    title: '游戏 Agent',
    placeholder: '询问当前游戏状态或下一步建议…',
    empty: '我会先读取当前游戏状态，再根据你的问题回答。第一阶段不会操作游戏。',
    retry: '重试连接',
    stop: '停止',
    newSession: '新会话',
    send: '发送',
    settings: 'Agent 接入配置',
    profile: '平台',
    model: '模型',
    observing: '正在读取游戏状态…',
    thinking: 'Ollama 正在回答…',
    unavailable: 'Agent 暂不可用',
  },
  en: {
    title: 'Game Agent',
    placeholder: 'Ask about the current game state or next step…',
    empty: 'I will inspect the current game state before answering. This first version will not control the game.',
    retry: 'Retry connection',
    stop: 'Stop',
    newSession: 'New session',
    send: 'Send',
    settings: 'Agent connection settings',
    profile: 'Provider',
    model: 'Model',
    observing: 'Reading game state…',
    thinking: 'Ollama is answering…',
    unavailable: 'Agent unavailable',
  },
  ja: {
    title: 'ゲーム Agent',
    placeholder: '現在の状態や次の行動を質問…',
    empty: '回答前に現在のゲーム状態を確認します。この段階ではゲームを操作しません。',
    retry: '再接続',
    stop: '停止',
    newSession: '新しい会話',
    send: '送信',
    settings: 'Agent 接続設定',
    profile: 'プロバイダー',
    model: 'モデル',
    observing: 'ゲーム状態を確認中…',
    thinking: 'Ollama が回答中…',
    unavailable: 'Agent を利用できません',
  },
  ko: {
    title: '게임 Agent',
    placeholder: '현재 게임 상태나 다음 행동을 질문하세요…',
    empty: '답변 전에 현재 게임 상태를 확인합니다. 첫 단계에서는 게임을 조작하지 않습니다.',
    retry: '다시 연결',
    stop: '중지',
    newSession: '새 대화',
    send: '보내기',
    settings: 'Agent 연결 설정',
    profile: '공급자',
    model: '모델',
    observing: '게임 상태 확인 중…',
    thinking: 'Ollama 응답 중…',
    unavailable: 'Agent를 사용할 수 없습니다',
  },
}

function errorMessage(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

type Props = {
  gameId: string
  open: boolean
  onClose: () => void
  request: (path: string, init?: RequestInit) => Promise<Response>
}

export function GameAgentSidebar({ gameId, open, onClose, request }: Props) {
  const locale = useLocaleCode()
  const copy = COPY[locale] || COPY.en
  const [status, setStatus] = useState<Status | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [model, setModel] = useState('')
  const [profileId, setProfileId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [newSession, setNewSession] = useState(false)
  const [turnId, setTurnId] = useState('')
  const [phase, setPhase] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [width, setWidth] = useState(() => Math.max(320, Math.min(560, Number(localStorage.getItem('chaya.gameAgent.width')) || 400)))
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const running = !!turnId

  const refresh = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const response = await request(`/api/game-agent/status?gameId=${encodeURIComponent(gameId)}`)
      const body = (await response.json()) as Status & { ok?: boolean }
      if (!response.ok) throw new Error(errorMessage(body, `HTTP ${response.status}`))
      setStatus(body)
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

  const profile = status?.profiles.find((item) => item.id === profileId) || null

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [messages, phase])

  const stop = useCallback(async () => {
    abortRef.current?.abort()
    if (turnId) await request(`/api/game-agent/turn/${encodeURIComponent(turnId)}`, { method: 'DELETE' }).catch(() => null)
    setTurnId('')
    setPhase('')
  }, [request, turnId])

  useEffect(() => {
    const onStop = () => void stop()
    window.addEventListener('chaya:game-agent-stop', onStop)
    return () => window.removeEventListener('chaya:game-agent-stop', onStop)
  }, [stop])

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text || !model || running || !status?.available) return
    const assistantId = `assistant-${Date.now()}`
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text }, { id: assistantId, role: 'assistant', text: '' }])
    setPrompt('')
    setPhase(copy.observing)
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const response = await request('/api/game-agent/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, sessionId: sessionId || undefined, newSession, profileId, model, mode: 'ask', prompt: text, locale }),
        signal: abort.signal,
      })
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null)
        throw new Error(errorMessage(body, `HTTP ${response.status}`))
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
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
          const item = JSON.parse(data) as { type: string; turnId?: string; sessionId?: string; phase?: string; text?: string; message?: string }
          if (item.type === 'turn.started') {
            setTurnId(item.turnId || '')
            setSessionId(item.sessionId || '')
            setNewSession(false)
          } else if (item.type === 'phase') {
            setPhase(item.phase === 'observing' ? copy.observing : copy.thinking)
          } else if (item.type === 'assistant.delta') {
            setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, text: message.text + (item.text || '') } : message)))
          } else if (item.type === 'turn.failed') {
            throw new Error(item.message || 'Agent failed')
          }
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setMessages((current) => [...current, { id: `error-${Date.now()}`, role: 'error', text: error instanceof Error ? error.message : String(error) }])
      }
    } finally {
      abortRef.current = null
      setTurnId('')
      setPhase('')
    }
  }

  const resize = (event: React.PointerEvent) => {
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
    <aside className="relative flex h-full min-h-0 flex-col border-l border-line bg-panel shadow-[-16px_0_42px_rgb(0_0_0/0.34)]" style={{ width }} aria-label={copy.title}>
      <div className="absolute top-0 bottom-0 left-[-4px] z-10 w-2 cursor-ew-resize" onPointerDown={resize} aria-hidden />
      {view === 'settings' ? (
        <GameAgentSettingsPanel request={request} onBack={() => setView('chat')} onSaved={() => void refresh()} />
      ) : (
        <>
          <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-3">
            <strong className="text-sm text-ink">{copy.title}</strong>
            <span className={cn('h-2 w-2 rounded-full', status?.available ? 'bg-ok' : 'bg-fail')} aria-hidden />
            <div className="min-w-0 flex-1" />
            <Button variant="ghost" size="icon" aria-label={copy.settings} tooltip={copy.settings} onClick={() => setView('settings')}>
              <IoSettingsOutline size={16} aria-hidden />
            </Button>
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
            <Button variant="ghost" size="icon" aria-label={copy.title} tooltip={copy.title} onClick={onClose}>
              <IoCloseOutline size={17} aria-hidden />
            </Button>
          </header>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {!status?.available ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center text-ink-soft">
                {loadingStatus ? <Spinner /> : <strong className="text-ink">{copy.unavailable}</strong>}
                <p className="m-0 max-w-70 text-xs leading-5">{status?.reason || copy.empty}</p>
                <Button variant="ghost" loading={loadingStatus} onClick={() => void refresh()}>
                  <IoRefreshOutline size={15} aria-hidden /> {copy.retry}
                </Button>
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
                    {message.text || (running && message.role === 'assistant' ? <Spinner size="sm" /> : null)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {phase ? <div className="shrink-0 border-t border-line-soft px-4 py-2 text-xs text-ink-soft">{phase}</div> : null}
          <form className="shrink-0 px-3 pt-1 pb-3" onSubmit={(event) => void send(event)}>
            <div className="rounded-lg border border-line bg-panel-2 px-3 pt-2 shadow-[0_6px_24px_rgb(0_0_0/0.2)] focus-within:border-accent">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  event.stopPropagation()
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                onKeyUp={(event) => event.stopPropagation()}
                placeholder={copy.placeholder}
                disabled={!status?.available}
                rows={2}
                className="block min-h-16 w-full resize-none border-0 bg-transparent py-1 text-sm leading-6 text-ink outline-none placeholder:text-ink-soft"
              />
              <div className="flex min-w-0 items-center gap-1.5 border-t border-line-soft py-2">
                <Select
                  value={profileId}
                  options={(status?.profiles || []).map((item) => ({ value: item.id, label: item.label }))}
                  onChange={(nextId) => {
                    const next = status?.profiles.find((item) => item.id === nextId)
                    setProfileId(nextId)
                    setModel(next?.defaultModel || next?.models[0]?.name || '')
                  }}
                  disabled={running || !status?.profiles.length}
                  className="max-w-30"
                  panelWidth="content"
                  aria-label={copy.profile}
                />
                <Select
                  value={model}
                  options={(profile?.models || []).map((item) => ({ value: item.name, label: item.name }))}
                  onChange={setModel}
                  disabled={running || !profile?.online}
                  className="min-w-0 max-w-40 flex-1"
                  panelWidth="content"
                  aria-label={copy.model}
                />
                <div className="ml-auto shrink-0">
                  {running ? (
                    <Button variant="fail" size="icon" aria-label={copy.stop} tooltip={copy.stop} onClick={() => void stop()}>
                      <IoStop size={17} aria-hidden />
                    </Button>
                  ) : (
                    <Button
                      variant="accent"
                      size="icon"
                      type="submit"
                      aria-label={copy.send}
                      tooltip={copy.send}
                      disabled={!prompt.trim() || !status?.available || !profileId || !model}
                    >
                      <IoSend size={16} aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {profile && !profile.online ? <div className="px-1 pt-1.5 text-xs text-fail">{profile.reason}</div> : null}
          </form>
        </>
      )}
    </aside>
  )
}
