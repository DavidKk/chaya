'use client'

import { OpenApiView } from '@/components/integration/openapi/OpenApiView'

export function GameEditOpenApiPane() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <OpenApiView />
    </div>
  )
}

export default GameEditOpenApiPane
