'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import { AgentActivityLogPanel } from '@/components/game-agent/AgentActivityLogPanel'
import { AgentCliProcessesPanel } from '@/components/game-agent/AgentCliProcessesPanel'
import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'
import { LogPanel } from '@/components/LogPanel'
import { hrefWithQuery, patchSearchParams } from '@/lib/url/search-params'

import { parseLogsSection } from './sections'

export function LogsSectionView() {
  const params = useParams<{ section?: string }>()
  const section = parseLogsSection(params.section)
  const { request } = useGameAgentRequest()
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedTaskId = searchParams.get('taskId') || ''
  const selectTask = useCallback(
    (taskId: string) => {
      const query = patchSearchParams(searchParams, { taskId: taskId || null })
      router.replace(hrefWithQuery(`/logs/${section}`, query), { scroll: false })
    },
    [router, searchParams, section]
  )

  if (section === 'agent') return <AgentActivityLogPanel request={request} selection={selectedTaskId} onSelectionChange={selectTask} />
  if (section === 'cli') return <AgentCliProcessesPanel request={request} />
  return <LogPanel />
}
