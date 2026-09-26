/**
 * 打开系统原生选择器，返回绝对路径。
 *
 * 分发一目了然：见 `services/platform/pick/index.ts` 对照表；
 * 各平台实现：`pick/osx.ts` | `windows.ts` | `linux.ts` | `edge.ts`。
 *
 * UX 硬约束见 `docs/technical/game-path-picker.md`。
 */
import { resolvePickPath } from '@/services/platform'

import type { PickKind, PickResult } from './picker-types'

export type { PickKind, PickResult }

export async function pickPath(kind: PickKind, prompt?: string): Promise<PickResult> {
  return resolvePickPath().pick(kind, prompt)
}
