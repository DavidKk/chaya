/**
 * 构建目标（见 docs/technical/service-modes.md §8）：next.config 按阶段注入 `NEXT_PUBLIC_CHAYA_TARGET`，
 * 构建产物内是常量，另一分支在服务端与客户端 bundle 中都会被摇掉。
 * - dev：`pnpm dev`，可在 edge / server 间热切换
 * - edge：Vercel / `pnpm build:edge`，不含 `*.server.ts(x)` 路由
 * - server：`pnpm build` → `pnpm start`；Electron App 是同一产物 + standalone 打包
 */
export type BuildTarget = 'dev' | 'edge' | 'server'
export type DevTarget = 'edge' | 'server'

export const BUILD_TARGET = (process.env.NEXT_PUBLIC_CHAYA_TARGET || 'server') as BuildTarget

/** 动态键读取，避免被构建期内联；dev 服务进程内 proxy 与 Route 共享 */
const DEV_TARGET_ENV = 'CHAYA_DEV_TARGET'

export function isDevTarget(value: unknown): value is DevTarget {
  return value === 'edge' || value === 'server'
}

/** 仅 dev 有意义：开关当前值；未切换过时沿用启动时的 `CHAYA_DEV_TARGET` / `CHAYA_SERVICE=vercel` */
export function getDevTarget(): DevTarget {
  const explicit = process.env[DEV_TARGET_ENV]
  if (isDevTarget(explicit)) return explicit
  return process.env.CHAYA_SERVICE?.trim().toLowerCase() === 'vercel' ? 'edge' : 'server'
}

export function setDevTarget(target: DevTarget): void {
  process.env[DEV_TARGET_ENV] = target
}
