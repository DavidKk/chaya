import type { ReactNode } from 'react'

import { RemoteShell } from '@/components/remote-play/RemoteShell'

/** 云游戏多端串流管理与配置 */
export default function RemoteLayout({ children }: { children: ReactNode }) {
  return <RemoteShell>{children}</RemoteShell>
}
