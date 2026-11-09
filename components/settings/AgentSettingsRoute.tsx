'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'
import { returnToNavigationSource } from '@/lib/ui/navigation-restoration'

import { AgentSettingsView } from './AgentSettingsView'

export function AgentSettingsRoute({ agentId, basePath = '/ai/agents' }: { agentId?: string; basePath?: string }) {
  const router = useRouter()
  const { request } = useGameAgentRequest()
  const navigate = useCallback(
    (id?: string) => {
      if (id) {
        const href = `${basePath}/${encodeURIComponent(id)}`
        if (agentId === 'new') router.replace(href)
        else router.push(href)
      } else returnToNavigationSource(router, basePath)
    },
    [router, agentId, basePath]
  )
  return <AgentSettingsView request={request} agentId={agentId} onNavigate={navigate} />
}
