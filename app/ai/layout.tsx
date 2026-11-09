import type { ReactNode } from 'react'

import { AiShell } from '@/components/ai/AiShell'

export default function AiLayout({ children }: { children: ReactNode }) {
  return <AiShell>{children}</AiShell>
}
