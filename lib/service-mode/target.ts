/**
 * 构建目标（见 docs/technical/service-modes.md §8）：next.config 按阶段注入 `NEXT_PUBLIC_CHAYA_TARGET`，
 * 构建产物内是常量，另一分支在服务端与客户端 bundle 中都会被摇掉。
 * - dev：`pnpm dev`，可在 cloud / server 间热切换
 * - cloud：远程部署 / `pnpm build:cloud`，不含 `*.server.ts(x)` 路由
 * - server：`pnpm build` → `pnpm start`；Electron App 是同一产物 + standalone 打包
 */
export type BuildTarget = 'dev' | 'cloud' | 'server'
export type DevTarget = 'cloud' | 'server'

function parseBuildTarget(value: string | undefined): BuildTarget {
  const target = value?.trim().toLowerCase() || 'server'
  if (target === 'dev' || target === 'cloud' || target === 'server') return target
  throw new Error(`NEXT_PUBLIC_CHAYA_TARGET 配置无效：${value}；只支持 dev、cloud、server`)
}

export const BUILD_TARGET = parseBuildTarget(process.env.NEXT_PUBLIC_CHAYA_TARGET)

/** 动态键读取，避免被构建期内联；dev 服务进程内 proxy 与 Route 共享 */
const DEV_TARGET_ENV = 'CHAYA_DEV_TARGET'

export function isDevTarget(value: unknown): value is DevTarget {
  return value === 'cloud' || value === 'server'
}

/** 仅 dev 有意义：开关当前值；未切换过时沿用启动时的 `CHAYA_DEV_TARGET` / `CHAYA_SERVICE=remote` */
export function getDevTarget(): DevTarget {
  const raw = process.env[DEV_TARGET_ENV]
  const explicit = raw?.trim().toLowerCase()
  if (isDevTarget(explicit)) return explicit
  if (explicit) throw new Error(`CHAYA_DEV_TARGET 配置无效：${raw}；只支持 cloud、server`)
  return process.env.CHAYA_SERVICE?.trim().toLowerCase() === 'remote' ? 'cloud' : 'server'
}

export function setDevTarget(target: DevTarget): void {
  process.env[DEV_TARGET_ENV] = target
}
