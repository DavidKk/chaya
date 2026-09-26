import { Suspense } from 'react'

import { LogsPage } from '@/components/LogsPage'

export default function LogsRoute() {
  return (
    <Suspense fallback={null}>
      <LogsPage />
    </Suspense>
  )
}
