'use client'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'

import { type ToolPage, ToolSettingsView } from './ToolSettingsView'

export function ToolSettingsRoute({ page }: { page: ToolPage }) {
  const { request } = useGameAgentRequest()
  return <ToolSettingsView page={page} request={request} />
}
