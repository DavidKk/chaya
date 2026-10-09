'use client'

import { LuBot, LuScrollText } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { pageMainFlush, panelBody } from '@/components/layoutClasses'
import { LogPanel } from '@/components/LogPanel'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import { useQueryPatch } from '@/lib/url/use-query-patch'

import { AgentActivityLogPanel } from './game-agent/AgentActivityLogPanel'

export function LogsPage() {
  const t = useT()
  const { searchParams, replaceQuery } = useQueryPatch()
  const view = searchParams.get('view') === 'agent' ? 'agent' : 'runtime'
  const views = [
    { id: 'runtime' as const, label: t('logs.runtime'), icon: LuScrollText },
    { id: 'agent' as const, label: t('logs.agentActivity'), icon: LuBot },
  ]
  return (
    <div className={pageMainFlush}>
      <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
        <SectionSideNav label={t('nav.logs')}>
          {views.map((item) => {
            const active = view === item.id
            return (
              <li key={item.id}>
                <Tooltip content={item.label} placement="right">
                  <button
                    type="button"
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={`${sectionSideNavItemClass(active)} cursor-pointer`}
                    onClick={() => replaceQuery({ view: item.id === 'runtime' ? null : item.id })}
                  >
                    <SectionSideNavItemContent active={active} icon={<item.icon size={17} />} />
                  </button>
                </Tooltip>
              </li>
            )
          })}
        </SectionSideNav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{view === 'runtime' ? <LogPanel /> : <AgentActivityLogPanel />}</div>
      </div>
    </div>
  )
}
