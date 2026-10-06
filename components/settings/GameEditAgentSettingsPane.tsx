'use client'

import { useEffect } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useViewState } from '@/lib/view-state'

import { AgentSettingsView } from './AgentSettingsView'
import { type SettingsSection, SettingsSectionNav } from './SettingsSectionNav'
import { ToolSettingsView } from './ToolSettingsView'

export function GameEditAgentSettingsPane({ request }: { request: GameAgentRequest }) {
  const [agentId, setAgentId] = useViewState<string | undefined>('settings.agentId', undefined, (v): v is string | undefined => v === undefined || typeof v === 'string')
  const [section, setSection] = useViewState<SettingsSection>('settings.section', 'agents', (v): v is SettingsSection => v === 'agents' || v === 'minimap' || v === 'companion')

  useEffect(() => {
    const reset = () => {
      setAgentId(undefined)
      setSection('agents')
    }
    window.addEventListener('chaya:game-settings-opened', reset)
    return () => window.removeEventListener('chaya:game-settings-opened', reset)
  }, [setAgentId, setSection])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2 md:flex-row">
      <SettingsSectionNav
        active={section}
        onSelect={(next) => {
          setSection(next)
          setAgentId(undefined)
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'agents' ? <AgentSettingsView request={request} agentId={agentId} onNavigate={setAgentId} /> : <ToolSettingsView page={section} request={request} />}
      </div>
    </div>
  )
}
