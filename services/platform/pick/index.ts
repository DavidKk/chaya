/**
 * pickPath —— 一眼对照表（改某平台只动对应文件）
 *
 * | lane\os | osx                         | windows                         | linux                         |
 * |---------|-----------------------------|---------------------------------|-------------------------------|
 * | local   | ./osx OsxPickPath           | ./windows WindowsPickPath       | ./linux LinuxPickPath         |
 * | remote | ./remote RemotePickPath（全 OS） | 同左                            | 同左                          |
 */
import { getPlatformContext, type HostOs } from '@/lib/platform'

import { LinuxPickPath } from './linux'
import { OsxPickPath } from './osx'
import { RemotePickPath } from './remote'
import type { PickPathCapability } from './types'
import { WindowsPickPath } from './windows'

export const PICK_PATH_CAPABILITY = 'pickPath' as const

const localByOs: Record<HostOs, PickPathCapability> = {
  osx: new OsxPickPath(),
  windows: new WindowsPickPath(),
  linux: new LinuxPickPath(),
}

const remoteImpl: PickPathCapability = new RemotePickPath()

/** 按当前 HostOs × RuntimeLane 取实现（对照表即文档，无全局注册器） */
export function resolvePickPath(): PickPathCapability {
  const { os, lane } = getPlatformContext()
  if (lane === 'remote') return remoteImpl
  return localByOs[os]
}

export type { PickPathCapability } from './types'
