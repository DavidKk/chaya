import type { ReactNode } from 'react'

import { LogsShell } from '@/components/logs/LogsShell'

export default function LogsLayout({ children }: { children: ReactNode }) {
  return <LogsShell>{children}</LogsShell>
}
