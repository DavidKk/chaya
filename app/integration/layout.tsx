import type { ReactNode } from 'react'

import { IntegrationShell } from '@/components/integration/IntegrationShell'

/** 集成：不要求绑定游戏，三种形态都可打开 */
export default function IntegrationLayout({ children }: { children: ReactNode }) {
  return <IntegrationShell>{children}</IntegrationShell>
}
