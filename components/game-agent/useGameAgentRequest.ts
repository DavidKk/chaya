'use client'

import { useCallback, useMemo } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { normalizeAgentTimeouts } from '@/lib/game-agent/timeouts'

import { createBrowserGameAgentRequest } from './browserRequest'
import { createBrowserAgentRuntime } from './browserTurn'
import type { GameAgentRequest } from './GameAgentWorkspace'

export function useGameAgentRequest() {
  const { browserMode, connected, roomId, send, subscribeMessages } = useGameLinkContext()
  const serverRequest = useCallback<GameAgentRequest>((path, init) => fetch(path, init), [])
  const browserRuntime = useMemo(() => createBrowserAgentRuntime(), [])
  const agentTask = useCallback(
    (message: Exclude<import('@/lib/runtime/game-link-protocol').AgentTaskMessage, { type: 'agent.task.result' }>, signal?: AbortSignal) =>
      new Promise<unknown>((resolve, reject) => {
        if (!connected) return reject(new Error('托管需要先连接游戏'))
        let timeoutMs = 15_000
        try {
          const raw = localStorage.getItem('chaya.gameAgent.settings')
          const profiles = raw ? (JSON.parse(raw) as { profiles?: Array<{ id?: string; gameCallTimeoutMs?: number }> }).profiles : undefined
          const profileId = 'profileId' in message ? message.profileId : undefined
          const profile = profiles?.find((item) => item.id === profileId)
          timeoutMs = normalizeAgentTimeouts({ gameCallTimeoutMs: profile?.gameCallTimeoutMs }).gameCallTimeoutMs
        } catch {
          /* Use the shared default when local browser settings are unavailable. */
        }
        const timer = window.setTimeout(() => finish(new Error(`游戏 ${Math.round(timeoutMs / 1000)} 秒内未响应 Agent 请求`)), timeoutMs)
        const unsubscribe = subscribeMessages((reply) => {
          if (reply.type !== 'agent.task.result' || reply.requestId !== message.requestId) return
          if (reply.ok) finish(null, reply.data)
          else finish(new Error(reply.error || 'Agent 请求失败'))
        })
        const abort = () => finish(signal?.reason instanceof Error ? signal.reason : new DOMException('已取消', 'AbortError'))
        const finish = (error: Error | null, value?: unknown) => {
          window.clearTimeout(timer)
          unsubscribe()
          signal?.removeEventListener('abort', abort)
          if (error) reject(error)
          else resolve(value)
        }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        else send(message)
      }),
    [connected, send, subscribeMessages]
  )
  const browserRequest = useMemo(() => createBrowserGameAgentRequest({ connected, agentTask }, browserRuntime), [browserRuntime, connected, agentTask])
  return { request: browserMode ? browserRequest : serverRequest, roomId, browserMode }
}
