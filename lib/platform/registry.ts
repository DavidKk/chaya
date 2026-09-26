import { getPlatformContext } from './env'
import type { CapabilityId, PlatformContext, PlatformMatch } from './types'

function slotKey(os: string, lane: string): string {
  return `${os}:${lane}`
}

/**
 * 能力 × (OS × lane) 注册表。
 * 解析优先级：精确 → os:* → *:lane → *:*
 */
export class PlatformRegistry {
  private readonly slots = new Map<CapabilityId, Map<string, unknown>>()

  register<T>(capability: CapabilityId, match: PlatformMatch, impl: T): this {
    let table = this.slots.get(capability)
    if (!table) {
      table = new Map()
      this.slots.set(capability, table)
    }
    table.set(slotKey(match.os, match.lane), impl)
    return this
  }

  /** 同能力、同匹配覆盖写（测试 / 热替换） */
  replace<T>(capability: CapabilityId, match: PlatformMatch, impl: T): this {
    return this.register(capability, match, impl)
  }

  tryResolve<T>(capability: CapabilityId, ctx: PlatformContext = getPlatformContext()): T | null {
    const table = this.slots.get(capability)
    if (!table) return null
    const candidates = [slotKey(ctx.os, ctx.lane), slotKey(ctx.os, '*'), slotKey('*', ctx.lane), slotKey('*', '*')]
    for (const key of candidates) {
      if (table.has(key)) return table.get(key) as T
    }
    return null
  }

  resolve<T>(capability: CapabilityId, ctx: PlatformContext = getPlatformContext()): T {
    const hit = this.tryResolve<T>(capability, ctx)
    if (hit) return hit
    throw new Error(`未注册平台能力「${capability}」（os=${ctx.os}, lane=${ctx.lane}）`)
  }

  /** 测试用：清空 */
  clear(): void {
    this.slots.clear()
  }

  list(capability: CapabilityId): string[] {
    const table = this.slots.get(capability)
    return table ? [...table.keys()].sort() : []
  }
}

/** 进程内单例：各 capability 模块在 register 时写入 */
export const platformRegistry = new PlatformRegistry()
