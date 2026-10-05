'use client'

import { useEffect } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useViewState } from '@/lib/view-state'

import { AgentSettingsView } from './AgentSettingsView'
import { SettingsSectionNav } from './SettingsSectionNav'

export function GameEditAgentSettingsPane({ request }: { request: GameAgentRequest }) {
  const [agentId, setAgentId] = useViewState<string | undefined>('settings.agentId', undefined, (v): v is string | undefined => v === undefined || typeof v === 'string')

  useEffect(() => {
    const reset = () => setAgentId(undefined)
    window.addEventListener('chaya:game-settings-opened', reset)
    return () => window.removeEventListener('chaya:game-settings-opened', reset)
  }, [setAgentId])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2 md:flex-row">
      <SettingsSectionNav onSelect={() => setAgentId(undefined)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AgentSettingsView request={request} agentId={agentId} onNavigate={setAgentId} />
      </div>
    </div>
  )
}
