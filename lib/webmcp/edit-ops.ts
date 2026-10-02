/** `chaya_web_edit_*` argument parsing: agent input → validated `GameEditCmdOp` (same ops as the edit page). */

import { type ActorDraft, type ItemKind, RUN_ACTION_IDS, RUN_FLAG_KEYS, type RunActionId, type RunFlagKey } from '@/components/game-edit/types'
import type { GameEditCmdOp } from '@/lib/runtime/game-link-protocol'

export const EDIT_OPS = [
  'gold',
  'goldLock',
  'count',
  'countLock',
  'var',
  'varLock',
  'sw',
  'swLock',
  'runFlag',
  'walkRate',
  'runRate',
  'expRate',
  'actor',
  'actorVitalLock',
  'actorOwnedLock',
] as const satisfies readonly GameEditCmdOp['op'][]

const ITEM_KINDS: readonly ItemKind[] = ['item', 'weapon', 'armor']
const VITAL_KINDS = ['level', 'exp', 'hp', 'mp'] as const
const OWNED_KINDS = ['skills', 'states'] as const
const ACTOR_NUMBER_FIELDS = ['level', 'exp', 'hp', 'mp', 'mhp', 'mmp', 'atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'classId'] as const
const ACTOR_TEXT_FIELDS = ['name', 'nickname', 'profile'] as const

type Args = Record<string, unknown>

function num(args: Args, key: string): number {
  const v = args[key]
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new Error(`${key} 需为数字`)
  return n
}

function int(args: Args, key: string): number {
  return Math.trunc(num(args, key))
}

function bool(args: Args, key: string): boolean {
  const v = args[key]
  if (typeof v !== 'boolean') throw new Error(`${key} 需为布尔值`)
  return v
}

function oneOf<T extends string>(args: Args, key: string, values: readonly T[]): T {
  const v = args[key]
  if (typeof v !== 'string' || !values.includes(v as T)) throw new Error(`${key} 只能是：${values.join(', ')}`)
  return v as T
}

function actorPatch(raw: unknown): Partial<ActorDraft> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('patch 需为对象')
  const src = raw as Args
  const patch: Partial<ActorDraft> = {}
  for (const key of ACTOR_NUMBER_FIELDS) if (src[key] !== undefined) patch[key] = int(src, key)
  for (const key of ACTOR_TEXT_FIELDS) {
    if (src[key] === undefined) continue
    if (typeof src[key] !== 'string') throw new Error(`${key} 需为字符串`)
    patch[key] = src[key] as string
  }
  for (const key of ['skillIds', 'stateIds'] as const) {
    if (src[key] === undefined) continue
    const list = src[key]
    if (!Array.isArray(list) || list.some((id) => !Number.isInteger(id))) throw new Error(`${key} 需为整数数组`)
    patch[key] = list as number[]
  }
  if (!Object.keys(patch).length) throw new Error('patch 没有可修改的字段')
  return patch
}

export function parseEditOp(args: Args): GameEditCmdOp {
  const op = oneOf(args, 'op', EDIT_OPS)
  switch (op) {
    case 'gold':
      return { op, value: Math.max(0, int(args, 'value')) }
    case 'goldLock':
      return { op, on: bool(args, 'on'), value: Math.max(0, int(args, 'value')) }
    case 'count':
      return { op, kind: oneOf(args, 'kind', ITEM_KINDS), id: int(args, 'id'), value: Math.max(0, int(args, 'value')) }
    case 'countLock':
      return { op, kind: oneOf(args, 'kind', ITEM_KINDS), id: int(args, 'id'), on: bool(args, 'on'), value: Math.max(0, int(args, 'value')) }
    case 'var':
      return { op, id: int(args, 'id'), value: int(args, 'value') }
    case 'varLock':
      return { op, id: int(args, 'id'), on: bool(args, 'on'), value: int(args, 'value') }
    case 'sw':
      return { op, id: int(args, 'id'), value: bool(args, 'value') }
    case 'swLock':
      return { op, id: int(args, 'id'), on: bool(args, 'on'), value: typeof args.value === 'boolean' ? (args.value ? 1 : 0) : int(args, 'value') ? 1 : 0 }
    case 'runFlag':
      return { op, key: oneOf<RunFlagKey>(args, 'key', RUN_FLAG_KEYS), value: bool(args, 'value') }
    case 'walkRate':
    case 'runRate':
    case 'expRate':
      return { op, value: num(args, 'value') }
    case 'actor':
      return { op, id: int(args, 'id'), patch: actorPatch(args.patch) }
    case 'actorVitalLock':
      return { op, actorId: int(args, 'actorId'), kind: oneOf(args, 'kind', VITAL_KINDS), on: bool(args, 'on'), value: int(args, 'value') }
    case 'actorOwnedLock':
      return { op, actorId: int(args, 'actorId'), kind: oneOf(args, 'kind', OWNED_KINDS), entryId: int(args, 'entryId'), on: bool(args, 'on'), owned: bool(args, 'owned') }
  }
}

export function parseRunAction(args: Args): RunActionId {
  return oneOf<RunActionId>(args, 'id', RUN_ACTION_IDS)
}
