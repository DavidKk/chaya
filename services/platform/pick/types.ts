import type { PickKind, PickResult } from '@/services/game/picker-types'

/** 原生路径选择：同一能力，按 OS × lane 换实现 */
export interface PickPathCapability {
  readonly id: 'pickPath'
  pick(kind: PickKind, prompt?: string): Promise<PickResult>
}

export type { PickKind, PickResult }
