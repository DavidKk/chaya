import type { IconType } from 'react-icons'
import { LuSlidersHorizontal, LuTv } from 'react-icons/lu'

import type { MessageKey } from '@/lib/i18n'

export type RemoteTabId = 'instances' | 'settings'

export type RemoteTabItem = {
  id: RemoteTabId
  href: string
  labelKey: MessageKey
  icon: IconType
}

export const REMOTE_TABS: ReadonlyArray<RemoteTabItem> = [
  { id: 'instances', href: '/remote/instances', labelKey: 'nav.remoteInstances', icon: LuTv },
  { id: 'settings', href: '/remote/settings', labelKey: 'nav.remoteSettings', icon: LuSlidersHorizontal },
]

export function remoteTabFromPathname(pathname: string): RemoteTabId {
  if (pathname.includes('/remote/settings')) return 'settings'
  return 'instances'
}
