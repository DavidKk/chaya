'use client'

import { LuBot, LuScrollText } from 'react-icons/lu'

import { pageMainFlush, panelBody } from '@/components/layoutClasses'
import { LogPanel } from '@/components/LogPanel'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import { useQueryPatch } from '@/lib/url/use-query-patch'

import { AgentActivityLogPanel } from './game-agent/AgentActivityLogPanel'

const VIEWS = [
  { id: 'runtime' as const, label: '运行日志', icon: LuScrollText },
  { id: 'agent' as const, label: 'Agent 活动', icon: LuBot },
]

export function LogsPage() {
  const { searchParams, replaceQuery } = useQueryPatch()
  const view = searchParams.get('view') === 'agent' ? 'agent' : 'runtime'
  return (
    <div className={pageMainFlush}>
      <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
        <SectionSideNav label="日志类型" mobile>
          {VIEWS.map((item) => {
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
