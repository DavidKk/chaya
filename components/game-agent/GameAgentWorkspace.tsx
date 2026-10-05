'use client'

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IoArrowUp, IoCheckmark, IoCloseCircleOutline, IoCloseOutline, IoStop, IoTrashOutline } from 'react-icons/io5'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { Button, Spinner } from '@/components/sk'
import { cn } from '@/lib/utils'

import { GameAgentRuntimeMenu } from './GameAgentRuntimeMenu'

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
type ToolActivity = { id: string; name: string; state: 'running' | 'completed' | 'failed' }
type Message = { id: string; role: 'user' | 'assistant' | 'error'; text: string; tools?: ToolActivity[] }

type Copy = {
  title: string
  placeholder: string
  empty: string
  stop: string
  newSession: string
  send: string
  profile: string
  model: string
  observing: string
  thinking: string
  toolCalling: string
  toolCalled: string
  toolFailed: string
  unavailable: string
  connect: string
}

const COPY: Record<string, Copy> = {
  zh: {
    title: 'Chaya 助手',
    placeholder: '询问当前游戏状态或下一步建议…',
    empty: '我会读取当前游戏状态，并按你的要求调用可用工具。',
    stop: '停止',
    newSession: '新会话',
    send: '发送',
    profile: '平台',
    model: '模型',
    observing: '正在读取游戏状态…',
    thinking: 'Ollama 正在回答…',
    toolCalling: '正在调用',
    toolCalled: '已调用',
    toolFailed: '调用失败',
    unavailable: 'Agent 暂不可用',
    connect: '连接',
  },
  en: {
    title: 'Chaya Assistant',
    placeholder: 'Ask about the current game state or next step…',
    empty: 'I will inspect the current game and call available tools when needed.',
    stop: 'Stop',
    newSession: 'New session',
    send: 'Send',
    profile: 'Provider',
    model: 'Model',
    observing: 'Reading game state…',
    thinking: 'Ollama is answering…',
    toolCalling: 'Calling',
    toolCalled: 'Called',
    toolFailed: 'Call failed',
    unavailable: 'Agent unavailable',
    connect: 'Connect',
  },
  ja: {
    title: 'Chaya アシスタント',
    placeholder: '現在の状態や次の行動を質問…',
    empty: '現在のゲーム状態を確認し、必要に応じてツールを呼び出します。',
    stop: '停止',
    newSession: '新しい会話',
    send: '送信',
    profile: 'プロバイダー',
    model: 'モデル',
    observing: 'ゲーム状態を確認中…',
    thinking: 'Ollama が回答中…',
    toolCalling: '呼び出し中',
    toolCalled: '呼び出し済み',
    toolFailed: '呼び出し失敗',
    unavailable: 'Agent を利用できません',
    connect: '接続',
  },
  ko: {
    title: 'Chaya 어시스턴트',
    placeholder: '현재 게임 상태나 다음 행동을 질문하세요…',
    empty: '현재 게임 상태를 확인하고 필요할 때 도구를 호출합니다.',
    stop: '중지',
    newSession: '새 대화',
    send: '보내기',
    profile: '공급자',
    model: '모델',
    observing: '게임 상태 확인 중…',
    thinking: 'Ollama 응답 중…',
    toolCalling: '호출 중',
    toolCalled: '호출됨',
    toolFailed: '호출 실패',
    unavailable: 'Agent를 사용할 수 없습니다',
    connect: '연결',
  },
}

function errorMessage(body: unknown, fallback: string) {
  const value = body as { error?: { message?: unknown } }
  return typeof value?.error?.message === 'string' ? value.error.message : fallback
}

export type GameAgentRequest = (path: string, init?: RequestInit) => Promise<Response>

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
  const [phase, setPhase] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [width, setWidth] = useState(() => {
    const saved = typeof window === 'undefined' ? 400 : Number(localStorage.getItem('chaya.gameAgent.width')) || 400
    return Math.max(320, Math.min(560, saved))
  })
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
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

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
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
          const item = JSON.parse(data) as {
            type: string
            turnId?: string
            sessionId?: string
            phase?: string
            text?: string
            message?: string
            callId?: string
            name?: string
            ok?: boolean
          }
          if (item.type === 'turn.started') {
            setTurnId(item.turnId || '')
            setSessionId(item.sessionId || '')
            setNewSession(false)
          } else if (item.type === 'phase') {
            setPhase(item.phase === 'observing' ? copy.observing : copy.thinking)
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

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
                  {message.tools?.length ? (
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
                          <code className="truncate font-mono text-[11px] text-ink">{tool.name}</code>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.text || (running && message.role === 'assistant' && !message.tools?.length ? <Spinner size="sm" /> : null)}
                </div>
              ))}
            </div>
          )}
        </div>

        {phase ? <div className="shrink-0 border-t border-line-soft px-4 py-2 text-xs text-ink-soft">{phase}</div> : null}
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
              placeholder={copy.placeholder}
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
                {running ? (
                  <Button className="rounded-full" variant="fail" size="icon" aria-label={copy.stop} tooltip={copy.stop} onClick={() => void stop()}>
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
