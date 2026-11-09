'use client'

import { useEffect } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useT } from '@/components/i18n/LocaleProvider'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { AgentSettingsView } from '@/components/settings/AgentSettingsView'
import { Tooltip } from '@/components/sk'
import { useViewState } from '@/lib/view-state'

import { AI_SECTIONS, type AiSection, DEFAULT_AI_SECTION, isAiSection } from './ai-sections'
import { AiRolesView } from './AiRolesView'
import { RoleWorkspaceView } from './RoleWorkspaceView'

/** 局内浮层「AI」：与 Web `/ai/*` 同一组分区与组件，只换外壳 */
export function GameEditAiPane({ request }: { request: GameAgentRequest }) {
  const t = useT()
  const [agentId, setAgentId] = useViewState<string | undefined>('ai.agentId', undefined, (v): v is string | undefined => v === undefined || typeof v === 'string')
  const [roleId, setRoleId] = useViewState<string | undefined>('ai.roleId', undefined, (v): v is string | undefined => v === undefined || typeof v === 'string')
  const [workspaceRoleId, setWorkspaceRoleId] = useViewState<string | undefined>(
    'ai.workspaceRoleId',
    undefined,
    (v): v is string | undefined => v === undefined || typeof v === 'string'
  )
  const [section, setSection] = useViewState<AiSection>('ai.section', DEFAULT_AI_SECTION, isAiSection)

  useEffect(() => {
    const reset = () => {
      setAgentId(undefined)
      setRoleId(undefined)
      setWorkspaceRoleId(undefined)
      setSection(DEFAULT_AI_SECTION)
    }
    window.addEventListener('chaya:game-ai-opened', reset)
    return () => window.removeEventListener('chaya:game-ai-opened', reset)
  }, [setAgentId, setRoleId, setWorkspaceRoleId, setSection])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2 md:flex-row">
      <SectionSideNav label={t('nav.ai')} mobile>
        {AI_SECTIONS.map(({ id, labelKey, icon: Icon }) => {
          const label = t(labelKey)
          const active = section === id
          return (
            <li key={id}>
              <Tooltip content={label} placement="right">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  className={`${sectionSideNavItemClass(active)} cursor-pointer`}
                  onClick={() => {
                    setSection(id)
                    setAgentId(undefined)
                    setRoleId(undefined)
                    setWorkspaceRoleId(undefined)
                  }}
                >
                  <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'companion' ? (
          workspaceRoleId ? (
            <RoleWorkspaceView roleId={workspaceRoleId} onBack={() => setWorkspaceRoleId(undefined)} />
          ) : (
            <AiRolesView roleId={roleId} onNavigate={setRoleId} onOpenWorkspace={setWorkspaceRoleId} request={request} />
          )
        ) : (
          <AgentSettingsView request={request} agentId={agentId} onNavigate={setAgentId} />
        )}
      </div>
    </div>
  )
}

export default GameEditAiPane
