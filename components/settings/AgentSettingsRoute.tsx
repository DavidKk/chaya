'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'
import { returnToNavigationSource } from '@/lib/ui/navigation-restoration'

import { AgentSettingsView } from './AgentSettingsView'

export function AgentSettingsRoute({ agentId }: { agentId?: string }) {
  const router = useRouter()
  const { request } = useGameAgentRequest()
  const navigate = useCallback(
    (id?: string) => {
      if (id) {
        const href = `/assist/agents/${encodeURIComponent(id)}`
        if (agentId === 'new') router.replace(href)
        else router.push(href)
      } else returnToNavigationSource(router, '/assist/agents')
    },
    [router, agentId]
  )
  return <AgentSettingsView request={request} agentId={agentId} onNavigate={navigate} />
}
