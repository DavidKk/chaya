'use client'

import { useCallback, useMemo } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'

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
        if (!connected) return reject(new Error('帮玩需要先连接游戏'))
        const timer = window.setTimeout(() => finish(new Error('游戏 10 秒内未响应 Agent 请求')), 10_000)
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
