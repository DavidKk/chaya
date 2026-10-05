'use client'

import { useState } from 'react'
import { LuFileCode2, LuGlobe, LuPlug } from 'react-icons/lu'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useT } from '@/components/i18n/LocaleProvider'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'

import { GameEditMcpPane } from './GameEditMcpPane'
import { GameEditSkillsPane } from './GameEditSkillsPane'
import { GameEditWebMcpPane } from './GameEditWebMcpPane'

const SECTIONS = [
  { id: 'skills', labelKey: 'integration.tabSkills', icon: LuFileCode2 },
  { id: 'mcp', labelKey: 'integration.tabMcp', icon: LuPlug },
  { id: 'webmcp', labelKey: 'integration.tabWebMcp', icon: LuGlobe },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** In-game integration uses the same three sections as the console, inside the overlay. */
export function GameEditIntegrationPane({ request }: { request?: GameAgentRequest }) {
  const t = useT()
  const [section, setSection] = useState<SectionId>('mcp')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-paper md:flex-row">
      <SectionSideNav label={t('integration.section')} mobile>
        {SECTIONS.map((item) => {
          const active = section === item.id
          const label = t(item.labelKey)
          return (
            <li key={item.id}>
              <Tooltip content={label} placement="right">
                <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} className={sectionSideNavItemClass(active)} onClick={() => setSection(item.id)}>
                  <SectionSideNavItemContent active={active} icon={<item.icon size={17} />} />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'skills' ? <GameEditSkillsPane request={request} /> : section === 'webmcp' ? <GameEditWebMcpPane /> : <GameEditMcpPane />}
      </div>
    </div>
  )
}
