'use client'

import { useCallback, useMemo } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'

import { createBrowserGameAgentRequest } from './browserRequest'
import type { GameAgentRequest } from './GameAgentWorkspace'

export function useGameAgentRequest() {
  const { browserMode, connected, roomId } = useGameLinkContext()
  const serverRequest = useCallback<GameAgentRequest>((path, init) => fetch(path, init), [])
  const browserRequest = useMemo(() => createBrowserGameAgentRequest({ connected }), [connected])
  return { request: browserMode ? browserRequest : serverRequest, roomId, browserMode }
}
