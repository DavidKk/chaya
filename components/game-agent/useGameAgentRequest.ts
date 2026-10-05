'use client'

import { useCallback, useMemo } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'

import { createBrowserGameAgentRequest } from './browserRequest'
import { createBrowserAgentRuntime } from './browserTurn'
import type { GameAgentRequest } from './GameAgentWorkspace'

export function useGameAgentRequest() {
  const { browserMode, connected, roomId } = useGameLinkContext()
  const serverRequest = useCallback<GameAgentRequest>((path, init) => fetch(path, init), [])
  const browserRuntime = useMemo(() => createBrowserAgentRuntime(), [])
  const browserRequest = useMemo(() => createBrowserGameAgentRequest({ connected }, browserRuntime), [browserRuntime, connected])
  return { request: browserMode ? browserRequest : serverRequest, roomId, browserMode }
}
