import type { ReactNode } from 'react'

import { AssistShell } from '@/components/input-assistance/AssistShell'

export default function AssistLayout({ children }: { children: ReactNode }) {
  return <AssistShell>{children}</AssistShell>
}
