import { getServiceMode, type ServiceMode } from '@/lib/service-mode'

import type { HostOs, PlatformContext, RuntimeLane } from './types'

/** Node `process.platform` → HostOs；未知平台返回 null */
export function resolveHostOs(platform: NodeJS.Platform | string = process.platform): HostOs | null {
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  if (platform === 'darwin') return 'osx'
  return null
}

/** ServiceMode → RuntimeLane：app/local → local；vercel → edge */
export function resolveRuntimeLane(mode: ServiceMode = getServiceMode()): RuntimeLane {
  return mode === 'vercel' ? 'edge' : 'local'
}

export function getPlatformContext(opts?: { platform?: NodeJS.Platform | string; serviceMode?: ServiceMode }): PlatformContext {
  const os = resolveHostOs(opts?.platform ?? process.platform)
  if (!os) {
    throw new Error(`不支持的操作系统平台：${opts?.platform ?? process.platform}`)
  }
  return {
    os,
    lane: resolveRuntimeLane(opts?.serviceMode ?? getServiceMode()),
  }
}
