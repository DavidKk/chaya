/** Structure changes: array insert / copy / remove, object add / remove field; item bags and self switches map to writes */
import {
  DataError,
  type DataOp,
  type DataPath,
  type DataStructResult,
  insertModeFor,
  isReadonlyPath,
  isValidKey,
  isValidPath,
  matchesType,
  parseSelfSwitchKey,
  type PrimitiveValue,
} from '@/lib/game/save-data'

import { dropLocksFrom } from './locks'
import { ensureReady, invalidateKeys } from './read'
import { isDataProperty, resolveContainer } from './resolve'
import { pushUndo, type StructStep } from './undo'
import { writeBatch } from './write'
import { refreshKeyFor, runRefreshes } from './writers'

type StructOp = Extract<DataOp, { op: 'dataStruct' }>

const g = globalThis as { JsonEx?: { makeDeepCopy?: (v: unknown) => unknown } }

function primitiveOf(op: StructOp): PrimitiveValue {
  const type = op.valueType ?? 'null'
  const value = op.value ?? null
  if (!matchesType(value, type)) throw new DataError('值与类型不符', 'type')
  return value
}

function deepCopy(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  const copy = g.JsonEx?.makeDeepCopy
  if (typeof copy !== 'function') throw new DataError('当前游戏不支持复制该项', 'unsupported')
  return copy(value)
}

function requireConfirm(op: StructOp) {
  if (!op.confirmed) throw new DataError('需要确认', 'confirm')
}

function asIndex(n: unknown, max: number): number {
  const i = Number(n)
  if (!Number.isInteger(i) || i < 0 || i > max) throw new DataError('位置无效', 'invalid')
  return i
}

/** Item bags: add = set a count, remove = count to 0; both go through `gainItem` */
function itemStruct(op: StructOp): DataStructResult {
  const key = String(op.key ?? '')
  if (!/^[1-9]\d*$/.test(key)) throw new DataError('物品编号无效', 'invalid')
  const removing = op.action === 'remove' || op.action === 'removeKey'
  if (removing) requireConfirm(op)
  else if (op.action !== 'insert' && op.action !== 'addKey') throw new DataError('物品列表不支持该操作', 'unsupported')
  const count = removing ? 0 : Math.floor(Number(op.value))
  if (!Number.isFinite(count) || count < 0) throw new DataError('数量无效', 'type')
  return viaWrite(op, key, 'number', count)
}

function selfSwitchStruct(op: StructOp): DataStructResult {
  const key = String(op.key ?? '')
  if (!parseSelfSwitchKey(key)) throw new DataError('独立开关格式应为 地图,事件,A–D', 'invalid')
  if (op.action === 'removeKey') {
    requireConfirm(op)
    return viaWrite(op, key, 'boolean', false)
  }
  if (op.action !== 'addKey' || typeof op.value !== 'boolean') throw new DataError('独立开关只能添加布尔值', 'type')
  return viaWrite(op, key, 'boolean', op.value)
}

function viaWrite(op: StructOp, key: string, type: 'number' | 'boolean', value: number | boolean): DataStructResult {
  const path = [...op.path, key]
  const { results, steps } = writeBatch([{ path, ownerOid: op.ownerOid, type, value, confirmed: true }])
  const r = results[0]
  if (!r?.ok) throw new DataError(r?.error || '写入失败', r?.code)
  pushUndo('write', steps)
  return { path: op.path }
}

export function applyStruct(op: StructOp): DataStructResult {
  ensureReady()
  if (!isValidPath(op.path)) throw new DataError('路径无效', 'invalid')
  const c = resolveContainer(op.path)
  if (!c.ok) throw new DataError('路径不存在', 'missing', c.existingDepth)
  if (c.oid !== op.ownerOid) throw new DataError('所属对象已变化', 'stale')
  const mode = insertModeFor(op.path)
  if (!mode) throw new DataError('该位置不允许增删', 'readonly')
  if (mode === 'item') return itemStruct(op)
  if (mode === 'selfSwitch') return selfSwitchStruct(op)

  const path: DataPath = op.path
  let step: StructStep
  let index: number | undefined
  let target: string

  if (Array.isArray(c.obj)) {
    const obj = c.obj as unknown[]
    if (op.action === 'insert') {
      index = asIndex(op.index ?? obj.length, obj.length)
      const value = primitiveOf(op)
      obj.splice(index, 0, value)
      step = { t: 'insert', path, ownerOid: c.oid, index, element: value }
    } else if (op.action === 'copy') {
      requireConfirm(op)
      const from = asIndex(op.from, obj.length - 1)
      index = asIndex(op.index ?? from + 1, obj.length)
      const element = deepCopy(obj[from])
      obj.splice(index, 0, element)
      step = { t: 'insert', path, ownerOid: c.oid, index, element }
    } else if (op.action === 'remove') {
      requireConfirm(op)
      index = asIndex(op.index, obj.length - 1)
      const [element] = obj.splice(index, 1)
      step = {
        t: 'remove',
        path,
        ownerOid: c.oid,
        index,
        element,
        expectedLength: obj.length,
        previous: index > 0 ? { exists: true, value: obj[index - 1] } : { exists: false },
        next: index < obj.length ? { exists: true, value: obj[index] } : { exists: false },
      }
    } else throw new DataError('数组不支持该操作', 'unsupported')
    target = String(index)
  } else {
    const obj = c.obj as Record<string, unknown>
    const key = op.key
    if (!isValidKey(key)) throw new DataError('字段名无效', 'invalid')
    if (op.action === 'addKey') {
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new DataError('字段已存在', 'invalid')
      if (key in obj || key.startsWith('@')) throw new DataError('该字段名会与游戏内部字段冲突', 'invalid')
      const value = primitiveOf(op)
      obj[key] = value
      step = { t: 'addKey', path, ownerOid: c.oid, key, value }
    } else if (op.action === 'removeKey') {
      requireConfirm(op)
      if (!isDataProperty(obj, key)) throw new DataError('字段不存在', 'missing')
      if (isReadonlyPath([...path, key])) throw new DataError('该字段只读', 'readonly')
      const value = obj[key]
      if (value != null && typeof value === 'object') throw new DataError('不能删除对象或数组字段', 'unsupported')
      delete obj[key]
      step = { t: 'removeKey', path, ownerOid: c.oid, key, value }
    } else throw new DataError('对象不支持该操作', 'unsupported')
    target = key
  }

  invalidateKeys(c.oid)
  if (index != null) dropLocksFrom(path, index)
  runRefreshes([refreshKeyFor([...path, target])])
  pushUndo('struct', [step])
  return index == null ? { path } : { path, index }
}
