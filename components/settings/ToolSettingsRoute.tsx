'use client'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'

import { FloatingBallSettingsView } from './FloatingBallSettingsView'
import { type ToolPage, ToolSettingsView } from './ToolSettingsView'

export function ToolSettingsRoute({ page }: { page: ToolPage | 'floating-ball' }) {
  const { request } = useGameAgentRequest()
  if (page === 'floating-ball') return <FloatingBallSettingsView request={request} />
  return <ToolSettingsView page={page} request={request} />
}
