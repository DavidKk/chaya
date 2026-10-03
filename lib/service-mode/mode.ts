import { BUILD_TARGET, getDevTarget } from './target'

/**
 * 三种服务形态：local | vercel | app（需求见 docs/requirements-service-modes.md）
 * 纯判定，无 fs。门禁见 assert.ts；构建目标见 target.ts。
 */
export type ServiceMode = 'local' | 'vercel' | 'app'

/** edge 构建 / Vercel 平台强制 vercel，避免误设 CHAYA_SERVICE=local 打开 DiskOps */
export function getServiceMode(): ServiceMode {
  if (BUILD_TARGET === 'edge' || process.env.VERCEL === '1') return 'vercel'
  const explicit = process.env.CHAYA_SERVICE?.trim().toLowerCase()
  if (BUILD_TARGET === 'dev') {
    if (getDevTarget() === 'edge') return 'vercel'
    return explicit === 'app' ? 'app' : 'local'
  }
  if (explicit === 'vercel' || explicit === 'app' || explicit === 'local') return explicit
  return 'local'
}

export function canUseDisk(mode = getServiceMode()): boolean {
  return mode !== 'vercel'
}

export function serviceModePayload() {
  const serviceMode = getServiceMode()
  return { serviceMode, canUseDisk: canUseDisk(serviceMode) }
}
