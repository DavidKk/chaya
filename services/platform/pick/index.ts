/**
 * pickPath —— 一眼对照表（改某平台只动对应文件）
 *
 * | lane\os | osx                         | windows                         | linux                         |
 * |---------|-----------------------------|---------------------------------|-------------------------------|
 * | local   | ./osx OsxPickPath           | ./windows WindowsPickPath       | ./linux LinuxPickPath         |
 * | edge    | ./edge EdgePickPath（全 OS） | 同左                            | 同左                          |
 */
import { getPlatformContext, type HostOs } from '@/lib/platform'

import { EdgePickPath } from './edge'
import { LinuxPickPath } from './linux'
import { OsxPickPath } from './osx'
import type { PickPathCapability } from './types'
import { WindowsPickPath } from './windows'

export const PICK_PATH_CAPABILITY = 'pickPath' as const

const localByOs: Record<HostOs, PickPathCapability> = {
  osx: new OsxPickPath(),
  windows: new WindowsPickPath(),
  linux: new LinuxPickPath(),
}

const edgeImpl: PickPathCapability = new EdgePickPath()

/** 按当前 HostOs × RuntimeLane 取实现（对照表即文档，无全局注册器） */
export function resolvePickPath(): PickPathCapability {
  const { os, lane } = getPlatformContext()
  if (lane === 'edge') return edgeImpl
  return localByOs[os]
}

export type { PickPathCapability } from './types'
