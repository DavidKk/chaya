/**
 * 运行环境二维：HostOs × RuntimeLane。
 * - HostOs：本机操作系统（windows / linux / osx）
 * - RuntimeLane：服务通道（local = 本机盘能力；edge = vercel 等无盘）
 *
 * `CHAYA_SERVICE=app` 与 `local` 同属 local lane（共用 DiskOps 实现）。
 */
export type HostOs = 'windows' | 'linux' | 'osx'

/** local：本机 / Toolkit App；edge：vercel 或 CHAYA_SERVICE=vercel 模拟 */
export type RuntimeLane = 'local' | 'edge'

export type PlatformContext = {
  os: HostOs
  lane: RuntimeLane
}

/** 注册匹配：`*` 表示该维通配 */
export type PlatformMatch = {
  os: HostOs | '*'
  lane: RuntimeLane | '*'
}

export type CapabilityId = string
