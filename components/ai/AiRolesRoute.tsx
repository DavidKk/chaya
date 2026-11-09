'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import { useGameAgentRequest } from '@/components/game-agent/useGameAgentRequest'

import { AiRolesView } from './AiRolesView'

export function AiRolesRoute({ roleId, basePath = '/ai/companion' }: { roleId?: string; basePath?: string }) {
  const { request } = useGameAgentRequest()
  const router = useRouter()
  const navigate = useCallback(
    (id?: string) => {
      if (id) {
        const href = `${basePath}/${encodeURIComponent(id)}`
        if (roleId === 'new') router.replace(href)
        else router.push(href)
      } else {
        router.push(basePath)
      }
    },
    [router, roleId, basePath]
  )
  return <AiRolesView roleId={roleId} onNavigate={navigate} request={request} />
}

export const AiCompanionRoute = AiRolesRoute
export default AiRolesRoute
