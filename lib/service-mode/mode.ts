import { BUILD_TARGET, getDevTarget } from './target'

/**
 * 三种服务形态：local | remote | app（需求见 docs/requirements-service-modes.md）
 * 纯判定，无 fs。门禁见 assert.ts；构建目标见 target.ts。
 */
export type ServiceMode = 'local' | 'remote' | 'app'

function parseExplicitServiceMode(): ServiceMode | undefined {
  const explicit = process.env.CHAYA_SERVICE?.trim().toLowerCase()
  if (!explicit) return undefined
  if (explicit === 'remote' || explicit === 'app' || explicit === 'local') return explicit
  throw new Error(`CHAYA_SERVICE 配置无效：${process.env.CHAYA_SERVICE}；只支持 local、app、remote`)
}

/** cloud 构建 / Vercel 平台强制 remote，避免误设 CHAYA_SERVICE=local 打开 DiskOps */
export function getServiceMode(): ServiceMode {
  const explicit = parseExplicitServiceMode()
  if (BUILD_TARGET === 'cloud' || process.env.VERCEL === '1') return 'remote'
  if (BUILD_TARGET === 'dev') {
    if (getDevTarget() === 'cloud') return 'remote'
    return explicit === 'app' ? 'app' : 'local'
  }
  return explicit ?? 'local'
}

export function canUseDisk(mode = getServiceMode()): boolean {
  return mode !== 'remote'
}

export function serviceModePayload() {
  const serviceMode = getServiceMode()
  return { serviceMode, canUseDisk: canUseDisk(serviceMode) }
}
