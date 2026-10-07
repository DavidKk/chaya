'use client'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'
import { MiniPanelsPage } from '@/components/game-tools/MiniPanelsPage'

export default function MiniPanelsRoute() {
  const { request } = useGameAgentRequest()
  return <MiniPanelsPage request={request} />
}
