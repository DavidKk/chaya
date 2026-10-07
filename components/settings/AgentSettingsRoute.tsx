'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'

import { AgentSettingsView } from './AgentSettingsView'

export function AgentSettingsRoute({ agentId }: { agentId?: string }) {
  const router = useRouter()
  const { request } = useGameAgentRequest()
  const navigate = useCallback((id?: string) => router.push(id ? `/assist/agents/${encodeURIComponent(id)}` : '/assist/agents'), [router])
  return <AgentSettingsView request={request} agentId={agentId} onNavigate={navigate} />
}
