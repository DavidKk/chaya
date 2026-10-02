'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { readApiErrorMessage } from '@/lib/api-error'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { AGENT_LINK_PATH, type AgentMethod, type AgentParams } from '@/lib/runtime/agent-protocol'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import type { TranslationRequestFn } from '@/lib/translate/runtime-api'

const CATALOG_TIMEOUT_MS = 10_000

type Deps = {
  connected: boolean
  send: (msg: GameLinkMessage) => void
  translationRequest: TranslationRequestFn
  subscribeMessages: (fn: (msg: GameLinkMessage) => void) => () => void
}

export type GameLinkRpc = {
  /** Run a ChayaAgent command in the game over the DataChannel (eval is refused game-side). */
  callAgent: <M extends AgentMethod>(method: M, params: AgentParams<M>, signal?: AbortSignal) => Promise<unknown>
  requestCatalog: () => Promise<GameEditCatalog>
  /** Ref-counted `edit.subscribe`; the returned release is idempotent. */
  acquireEditSession: () => () => void
}

/** Request helpers layered on the shared Web ↔ game DataChannel. */
export function useGameLinkRpc({ connected, send, translationRequest, subscribeMessages }: Deps): GameLinkRpc {
  const connectedRef = useRef(connected)
  connectedRef.current = connected
  const sendRef = useRef(send)
  sendRef.current = send
  const editCountRef = useRef(0)
  const subscribedRef = useRef(false)

  useEffect(() => {
    if (!connected) {
      subscribedRef.current = false
      return
    }
    if (editCountRef.current > 0 && !subscribedRef.current) {
      subscribedRef.current = true
      sendRef.current({ type: 'edit.subscribe' })
    }
  }, [connected])

  const acquireEditSession = useCallback(() => {
    editCountRef.current += 1
    if (connectedRef.current && !subscribedRef.current) {
      subscribedRef.current = true
      sendRef.current({ type: 'edit.subscribe' })
    }
    let released = false
    return () => {
      if (released) return
      released = true
      editCountRef.current = Math.max(0, editCountRef.current - 1)
      if (editCountRef.current === 0 && subscribedRef.current) {
        subscribedRef.current = false
        if (connectedRef.current) sendRef.current({ type: 'edit.unsubscribe' })
      }
    }
  }, [])

  const callAgent = useCallback(
    async <M extends AgentMethod>(method: M, params: AgentParams<M>, signal?: AbortSignal) => {
      const res = await translationRequest({ path: AGENT_LINK_PATH, method: 'POST', body: { method, params } }, signal)
      if (res.status >= 400 || res.data?.ok === false) throw new Error(readApiErrorMessage(res.data, `游戏执行 ${method} 失败`))
      return res.data.result
    },
    [translationRequest]
  )

  const requestCatalog = useCallback(
    () =>
      new Promise<GameEditCatalog>((resolve, reject) => {
        if (!connectedRef.current) return reject(new Error('游戏未连接'))
        const timer = window.setTimeout(() => {
          unsubscribe()
          reject(new Error('游戏 10 秒内未返回修改目录'))
        }, CATALOG_TIMEOUT_MS)
        const unsubscribe = subscribeMessages((msg) => {
          if (msg.type !== 'edit.catalog') return
          window.clearTimeout(timer)
          unsubscribe()
          resolve(msg.catalog)
        })
        sendRef.current({ type: 'edit.catalog.request' })
      }),
    [subscribeMessages]
  )

  return useMemo(() => ({ callAgent, requestCatalog, acquireEditSession }), [callAgent, requestCatalog, acquireEditSession])
}
