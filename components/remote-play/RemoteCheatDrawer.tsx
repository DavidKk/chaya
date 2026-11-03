'use client'

import React from 'react'

import { RemoteWorkspaceModal } from './workspace'
import type { RemoteWorkspaceProps, RemoteWorkspaceTab } from './workspace/types'

export type RemoteCheatDrawerProps = Omit<RemoteWorkspaceProps, 'initialTab'> & {
  initialTab?: 'cheat' | 'logs' | 'cheats' | 'debug'
}

export function RemoteCheatDrawer({ initialTab = 'cheats', ...props }: RemoteCheatDrawerProps) {
  const mappedTab: RemoteWorkspaceTab = initialTab === 'cheat' ? 'cheats' : initialTab
  return <RemoteWorkspaceModal {...props} initialTab={mappedTab} />
}
