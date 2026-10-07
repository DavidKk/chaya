'use client'

import { lazy } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import type { SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { EmptyState } from '@/components/sk'

import type { EventsSlot } from './types'

const CommonEventsPane = lazy(() => import('./CommonEventsPane').then((m) => ({ default: m.CommonEventsPane })))
const MapPane = lazy(() => import('./MapPane').then((m) => ({ default: m.MapPane })))
const TroopsPane = lazy(() => import('./TroopsPane').then((m) => ({ default: m.TroopsPane })))

type Props = {
  tab: 'common' | 'map' | 'troop'
  slot?: EventsSlot
  filter: string
  session: SessionState
  headSlot: HTMLDivElement | null
  toolRequest?: GameAgentRequest
  showMiniMap: boolean
}

/** 修改 › 公共事件 / 地图 / 敌群; the caller wraps it in Suspense */
export function EventsBody({ tab, slot, filter, session, headSlot, toolRequest, showMiniMap }: Props) {
  const t = useT()
  if (!slot) return <EmptyState title={t('events.needLink')} message={t('events.needLinkMsg')} />
  if (tab === 'common') return <CommonEventsPane slot={slot} filter={filter} session={session} headSlot={headSlot} />
  if (tab === 'troop') return <TroopsPane slot={slot} filter={filter} headSlot={headSlot} />
  return <MapPane slot={slot} filter={filter} session={session} headSlot={headSlot} toolRequest={toolRequest} showMiniMap={showMiniMap} />
}
