'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { WebGameLink } from '@/lib/runtime/web-game-link'

type Options = {
  roomId: string | null
  enabled?: boolean
  /**
   * 为 true 时挂载即发 offer（后台等游戏）。
   * 默认 false：只在 restart()/开始游戏 时协商，避免页面积压 WebRTC 请求。
   */
  autoStart?: boolean
  onMessage?: (msg: GameLinkMessage) => void
}

type SharedSlot = {
  roomId: string
  link: WebGameLink
  retain: number
  releaseTimer: ReturnType<typeof setTimeout> | null
}

/** 跨 React StrictMode / Suspense 重挂共用同一链路，避免疯狂 reset+offer */
let shared: SharedSlot | null = null

function releaseShared(slot: SharedSlot) {
  slot.retain -= 1
  if (slot.retain > 0) return
  if (slot.releaseTimer) clearTimeout(slot.releaseTimer)
  // 推迟释放：Strict Mode 会立刻再 mount
  slot.releaseTimer = setTimeout(() => {
    slot.releaseTimer = null
    if (slot.retain > 0) return
    if (shared === slot) {
      slot.link.stop()
      shared = null
    }
  }, 50)
}

function acquireShared(
  roomId: string,
  handlers: {
    onConnected?: () => void
    onDisconnected?: () => void
    onMessage?: (msg: GameLinkMessage) => void
  },
  autoStart: boolean
): WebGameLink {
  if (shared && shared.roomId === roomId) {
    if (shared.releaseTimer) {
      clearTimeout(shared.releaseTimer)
      shared.releaseTimer = null
    }
    shared.retain += 1
    shared.link.setHandlers(handlers)
    return shared.link
  }
  if (shared) {
    if (shared.releaseTimer) {
      clearTimeout(shared.releaseTimer)
      shared.releaseTimer = null
    }
    shared.link.stop()
    shared = null
  }
  const link = new WebGameLink(roomId, handlers)
  shared = { roomId, link, retain: 1, releaseTimer: null }
  if (autoStart) {
    void link.start().catch(() => {
      /* */
    })
  }
  return link
}

/** Dashboard：以 DataChannel 连接态为「游戏在线」 */
export function useGameLink({ roomId, enabled = true, autoStart = false, onMessage }: Options) {
  const [connected, setConnected] = useState(false)
  const [negotiating, setNegotiating] = useState(false)
  const linkRef = useRef<WebGameLink | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!enabled || !roomId) {
      if (linkRef.current && shared?.link === linkRef.current) {
        releaseShared(shared)
      } else {
        linkRef.current?.stop()
      }
      linkRef.current = null
      setConnected(false)
      setNegotiating(false)
      return
    }

    let cancelled = false
    const link = acquireShared(
      roomId,
      {
        onConnected: () => {
          if (!cancelled) {
            setConnected(true)
            setNegotiating(false)
          }
        },
        onDisconnected: () => {
          if (!cancelled) {
            setConnected(false)
            setNegotiating(false)
          }
        },
        onMessage: (msg) => onMessageRef.current?.(msg),
      },
      autoStart
    )
    linkRef.current = link
    setConnected(link.connected)
    setNegotiating(autoStart && !link.connected)

    return () => {
      cancelled = true
      if (shared?.link === link) releaseShared(shared)
      if (linkRef.current === link) linkRef.current = null
    }
  }, [roomId, enabled, autoStart])

  const roomIdLive = useRef(roomId)
  roomIdLive.current = roomId

  /** 重新发 offer（启动游戏前必须 await）；可传入 roomId 以免等 Provider 异步扫库 */
  const restart = useCallback(async (nextRoomId?: string) => {
    const id = String(nextRoomId || roomIdLive.current || '').trim()
    if (!id) return
    setNegotiating(true)
    setConnected(false)
    const link = acquireShared(
      id,
      {
        onConnected: () => {
          setConnected(true)
          setNegotiating(false)
        },
        onDisconnected: () => {
          setConnected(false)
          setNegotiating(false)
        },
        onMessage: (msg) => onMessageRef.current?.(msg),
      },
      false
    )
    linkRef.current = link
    try {
      await link.start()
    } catch {
      setNegotiating(false)
    }
  }, [])

  const send = useCallback((msg: GameLinkMessage) => linkRef.current?.send(msg), [])
  const quit = useCallback((reason?: string) => linkRef.current?.quit(reason), [])

  return {
    connected,
    negotiating,
    restart,
    quit,
    send,
  }
}
