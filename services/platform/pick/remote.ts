import type { PickKind, PickPathCapability, PickResult } from './types'

/** remote 服务无本机选择器 */
export class RemotePickPath implements PickPathCapability {
  readonly id = 'pickPath' as const

  async pick(_kind: PickKind, _prompt?: string): Promise<PickResult> {
    return {
      ok: false,
      error: 'Local path picker is not supported in current service mode',
    }
  }
}
