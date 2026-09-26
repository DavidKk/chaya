'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useGameLink } from '@/hooks/useGameLink'
import { CLOUD_GAME_SELECTION_EVENT, readCloudGameId } from '@/lib/browser/cloud-library'
import type { LibraryItemView } from '@/lib/game'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createTranslationRpc } from '@/lib/runtime/translation-rpc'
import type { TranslationRequestFn } from '@/lib/translate/runtime-api'

type StatusLite = {
  canUseDisk?: boolean
  ready?: boolean
  remote?: boolean
  config?: { gameRoot?: string }
  library?: LibraryItemView[]
}

function rootsEqual(a: string, b: string) {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '')
}

function libraryIdForRoot(library: LibraryItemView[], gameRoot: string): string | null {
  const hit = library.find((item) => rootsEqual(item.gameRoot, gameRoot))
  return hit?.id ?? null
}

type GameLinkContextValue = {
  roomId: string | null
  connected: boolean
  negotiating: boolean
  /** 启动前钉住房间 id（不必等 Provider 慢扫 /api/status） */
  armRoom: (id: string) => void
  restart: (roomId?: string) => Promise<void>
  quit: (reason?: string) => void
  send: (msg: GameLinkMessage) => void
  /** 订阅 DataChannel 消息；返回取消函数 */
  subscribeMessages: (fn: (msg: GameLinkMessage) => void) => () => void
  translationRequest: TranslationRequestFn
}

const GameLinkContext = createContext<GameLinkContextValue | null>(null)

/**
 * 全站共享 Web↔游戏 DataChannel（room = 当前库条目 id）。
 * 本机模式由启动操作发 offer；浏览器模式按持久化选中房间自动握手。
 */
export function GameLinkProvider({ children }: { children: ReactNode }) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [browserMode, setBrowserMode] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const listenersRef = useRef(new Set<(msg: GameLinkMessage) => void>())
  const roomIdRef = useRef<string | null>(null)
  const translationRef = useRef<ReturnType<typeof createTranslationRpc> | null>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/status')
        const data = (await res.json()) as StatusLite
        if (cancelled) return
        let nextId: string | null = null
        let nextEnabled = false
        setBrowserMode(data.canUseDisk === false)
        if (data.canUseDisk === false) {
          nextId = readCloudGameId()
          nextEnabled = !!nextId
        } else if (data.ready && !data.remote && data.config?.gameRoot) {
          nextId = libraryIdForRoot(data.library || [], data.config.gameRoot)
          nextEnabled = !!nextId
        }
        // 值未变不 setState，避免下游无意义重渲染
        if (roomIdRef.current !== nextId) {
          roomIdRef.current = nextId
          setRoomId(nextId)
        }
        setEnabled((prev) => (prev === nextEnabled ? prev : nextEnabled))
      } catch {
        /* */
      }
    }
    const update = () => void tick()
    window.addEventListener(CLOUD_GAME_SELECTION_EVENT, update)
    window.addEventListener('storage', update)
    void tick()
    // 房间 id 很少变，慢扫即可；Dashboard 自己有 status 轮询
    const timer = window.setInterval(() => void tick(), 30_000)
    return () => {
      cancelled = true
      window.removeEventListener(CLOUD_GAME_SELECTION_EVENT, update)
      window.removeEventListener('storage', update)
      window.clearInterval(timer)
    }
  }, [])

  const armRoom = useCallback((id: string) => {
    const next = String(id || '').trim()
    if (!next) return
    roomIdRef.current = next
    setRoomId(next)
    setEnabled(true)
  }, [])

  const onMessage = useCallback((msg: GameLinkMessage) => {
    if (msg.type === 'translation.rpc') {
      translationRef.current?.receive(msg)
      return
    }
    for (const fn of listenersRef.current) {
      try {
        fn(msg)
      } catch {
        /* */
      }
    }
  }, [])

  const link = useGameLink({ roomId, enabled, autoStart: browserMode, onMessage })
  const { connected, send } = link
  const translation = useMemo(() => {
    const rpc = createTranslationRpc((packet) => {
      if (!connected) throw new Error('请先连接游戏')
      return send(packet)
    })
    return { rpc, roomId, releaseTimer: null as ReturnType<typeof setTimeout> | null }
  }, [roomId, connected, send])
  translationRef.current = translation.rpc
  useEffect(() => {
    if (translation.releaseTimer) clearTimeout(translation.releaseTimer)
    // StrictMode 会立刻重挂；真正断线/切游戏时清理旧请求。
    return () => {
      translation.releaseTimer = setTimeout(() => translation.rpc.dispose(), 0)
    }
  }, [translation])

  const subscribeMessages = useCallback((fn: (msg: GameLinkMessage) => void) => {
    listenersRef.current.add(fn)
    return () => {
      listenersRef.current.delete(fn)
    }
  }, [])

  const value = useMemo<GameLinkContextValue>(
    () => ({
      roomId,
      connected: link.connected,
      negotiating: link.negotiating,
      armRoom,
      restart: link.restart,
      quit: link.quit,
      send: link.send,
      subscribeMessages,
      translationRequest: translation.rpc.request,
    }),
    [roomId, link.connected, link.negotiating, armRoom, link.restart, link.quit, link.send, subscribeMessages, translation]
  )

  return <GameLinkContext.Provider value={value}>{children}</GameLinkContext.Provider>
}

export function useGameLinkContext(): GameLinkContextValue {
  const ctx = useContext(GameLinkContext)
  if (!ctx) throw new Error('useGameLinkContext 需在 GameLinkProvider 内使用')
  return ctx
}
