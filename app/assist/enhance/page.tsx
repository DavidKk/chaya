'use client'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'
import { EnhanceSettingsView } from '@/components/settings/EnhanceSettingsView'

export default function EnhanceSettingsRoute() {
  const { request } = useGameAgentRequest()
  return <EnhanceSettingsView request={request} />
}
