/**
 * hostShell —— 一眼对照表（reveal / open / launchShell）
 *
 * | lane\os | osx                    | windows                      | linux                      |
 * |---------|------------------------|------------------------------|----------------------------|
 * | local   | ./osx OsxHostShell     | ./windows WindowsHostShell   | ./linux LinuxHostShell     |
 * | edge    | ./edge EdgeHostShell（全 OS） | 同左                     | 同左                       |
 */
import { getPlatformContext, type HostOs } from '@/lib/platform'

import { EdgeHostShell } from './edge'
import { LinuxHostShell } from './linux'
import { OsxHostShell } from './osx'
import type { HostShellCapability } from './types'
import { WindowsHostShell } from './windows'

export const HOST_SHELL_CAPABILITY = 'hostShell' as const

const localByOs: Record<HostOs, HostShellCapability> = {
  osx: new OsxHostShell(),
  windows: new WindowsHostShell(),
  linux: new LinuxHostShell(),
}

const edgeImpl: HostShellCapability = new EdgeHostShell()

export function resolveHostShell(): HostShellCapability {
  const { os, lane } = getPlatformContext()
  if (lane === 'edge') return edgeImpl
  return localByOs[os]
}

export type { HostShellCapability } from './types'
