import type { PickKind, PickPathCapability, PickResult } from './types'

/** edge（vercel）无本机选择器 */
export class EdgePickPath implements PickPathCapability {
  readonly id = 'pickPath' as const

  async pick(_kind: PickKind, _prompt?: string): Promise<PickResult> {
    return {
      ok: false,
      error: '当前服务形态不支持本机路径选择',
    }
  }
}
