'use client'

import { pageMainFlush } from '@/components/layoutClasses'
import { LogPanel } from '@/components/LogPanel'
import { SegmentedNav } from '@/components/sk'
import { useQueryPatch } from '@/lib/url/use-query-patch'

import { AgentActivityLogPanel } from './game-agent/AgentActivityLogPanel'

export function LogsPage() {
  const { searchParams, replaceQuery } = useQueryPatch()
  const view = searchParams.get('view') === 'agent' ? 'agent' : 'runtime'
  return (
    <div className={`${pageMainFlush} flex min-h-0 flex-col`}>
      <div className="shrink-0 border-b border-line bg-panel px-4 py-2">
        <SegmentedNav
          items={[
            { id: 'runtime', label: '运行日志', panelId: 'runtime-log-panel' },
            { id: 'agent', label: 'Agent 活动', panelId: 'agent-activity-panel' },
          ]}
          value={view}
          onChange={(next) => replaceQuery({ view: next === 'runtime' ? null : next })}
          aria-label="日志类型"
        />
      </div>
      <div id={`${view === 'runtime' ? 'runtime-log-panel' : 'agent-activity-panel'}`} role="tabpanel" className="min-h-0 flex-1">
        {view === 'runtime' ? <LogPanel /> : <AgentActivityLogPanel />}
      </div>
    </div>
  )
}
