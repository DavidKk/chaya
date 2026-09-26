'use client'

import { pageMainFlush } from '@/components/layoutClasses'
import { LogPanel } from '@/components/LogPanel'

export function LogsPage() {
  return (
    <div className={pageMainFlush}>
      <LogPanel />
    </div>
  )
}
