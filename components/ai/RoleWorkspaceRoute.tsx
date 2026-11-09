'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import { RoleWorkspaceView } from './RoleWorkspaceView'

export function RoleWorkspaceRoute({ roleId, basePath = '/ai/companion' }: { roleId: string; basePath?: string }) {
  const router = useRouter()
  const handleBack = useCallback(() => {
    router.replace(`${basePath}/${encodeURIComponent(roleId)}`)
  }, [router, roleId, basePath])

  return <RoleWorkspaceView roleId={roleId} onBack={handleBack} />
}

export default RoleWorkspaceRoute
