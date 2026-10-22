/** Batch writes: validate everything first, then write item by item, refresh once, and read back */
import {
  allowedTypes,
  annotate,
  DataError,
  type DataErrorCode,
  type DataPath,
  type DataWriteItem,
  type DataWriteResult,
  isReadonlyPath,
  isValidPath,
  kindOfPrimitive,
  matchesType,
  needsConfirm,
  presetLockFor,
  type PrimitiveValue,
  type ValueType,
  WRITE_BATCH_MAX,
} from '@/lib/game/save-data'

import { Cheats } from '../../runtime/cheats'
import { syncLockValue } from './locks'
import { liveNames } from './names'
import { cellAt, ensureReady } from './read'
import { resolve } from './resolve'
import { pushUndo, type SetStep } from './undo'
import { runRefreshes, writeValue } from './writers'

type Check = { ok: true } | { ok: false; code: DataErrorCode; error: string }

const fail = (code: DataErrorCode, error: string): Check => ({ ok: false, code, error })

function typesFor(path: DataPath, current: unknown): ValueType[] {
  const ann = annotate(path.slice(0, -1), path[path.length - 1], current, liveNames)
  const kind = kindOfPrimitive(current)
  return kind ? allowedTypes(kind, ann.expectType, ann.nullable ?? !ann.expectType) : []
}

const isConfigVolume = (path: DataPath) => path.length === 2 && path[0] === 'config' && path[1].endsWith('Volume')

function checkItem(item: DataWriteItem): Check {
  if (!isValidPath(item.path) || item.path.length < 2) return fail('invalid', '路径无效')
  const r = resolve(item.path)
  if (!r.exists) return fail('missing', '字段已不存在')
  if (r.ownerOid !== item.ownerOid) return fail('stale', '所属对象已变化')
  if (isReadonlyPath(item.path)) return fail('readonly', '该字段只读')
  if ((needsConfirm(item.path) || item.value === null) && !item.confirmed) return fail('confirm', '需要确认')
  if (r.value != null && typeof r.value === 'object') return fail('type', '容器字段不能直接修改')
  if (typeof r.value === 'function' || typeof r.value === 'symbol' || typeof r.value === 'bigint') return fail('type', '不支持的字段类型')
  if (!matchesType(item.value, item.type)) return fail('type', '值与类型不符')
  if (!typesFor(item.path, r.value).includes(item.type)) return fail('type', '不能修改为该类型')
  if (isConfigVolume(item.path) && !(Number.isInteger(item.value) && (item.value as number) >= 0 && (item.value as number) <= 100)) return fail('invalid', '音量应为 0–100 的整数')
  return { ok: true }
}

export type WriteBatch = { results: DataWriteResult[]; steps: SetStep[] }

/** Write without pushing undo; callers decide how the steps are grouped */
export function writeBatch(items: DataWriteItem[]): WriteBatch {
  ensureReady()
  if (!Array.isArray(items) || !items.length) throw new DataError('没有要写入的字段', 'invalid')
  if (items.length > WRITE_BATCH_MAX) throw new DataError(`一次最多写入 ${WRITE_BATCH_MAX} 项`, 'invalid')

  const checks = items.map(checkItem)
  if (checks.some((c) => !c.ok)) {
    return {
      results: items.map((item, i) => {
        const c = checks[i]
        return c.ok ? { path: item.path, ok: false } : { path: item.path, ok: false, code: c.code, error: c.error }
      }),
      steps: [],
    }
  }

  const refreshes: (string | null)[] = []
  const steps: SetStep[] = []
  const written: { item: DataWriteItem; index: number }[] = []
  const results: DataWriteResult[] = items.map((item) => ({ path: item.path, ok: false }))
  items.forEach((item, index) => {
    const r = resolve(item.path)
    if (!r.exists) {
      results[index] = { path: item.path, ok: false, code: 'missing', error: '字段已不存在' }
      return
    }
    try {
      const before = r.value as PrimitiveValue | undefined
      refreshes.push(writeValue(item.path, r.owner, r.key, item.value).refresh)
      steps.push({ t: 'set', path: item.path, ownerOid: r.ownerOid, before: { exists: true, value: before }, after: item.value })
      written.push({ item, index })
    } catch (err) {
      results[index] = { path: item.path, ok: false, code: 'invalid', error: err instanceof Error ? err.message : '写入失败' }
    }
  })
  runRefreshes(refreshes)

  for (const { item, index } of written) {
    const r = resolve(item.path)
    const readback = r.exists ? cellAt(item.path, r.value) : { kind: 'undefined' as const }
    const step = steps.find((s) => s.path === item.path)
    if (step) step.after = r.exists ? (r.value as PrimitiveValue | undefined) : undefined
    results[index] = { path: item.path, ok: true, readback }
    const raw = r.exists ? r.value : undefined
    syncLockValue(item.path, raw)
    syncPresetLock(item.path, raw)
  }
  return { results, steps }
}

function syncPresetLock(path: DataPath, value: unknown) {
  const preset = presetLockFor(path)
  if (!preset || !Cheats.isLocked(preset.kind, preset.id)) return
  const n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value)
  if (Number.isFinite(n)) Cheats.updateLockValue(preset.kind, preset.id, n)
}

export function applyWrites(items: DataWriteItem[]): DataWriteResult[] {
  const { results, steps } = writeBatch(items)
  pushUndo('write', steps)
  return results
}
