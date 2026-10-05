/** One level at a time: page listing, single rows by path, and full string reads */
import {
  annotate,
  type DataCell,
  DataError,
  type DataMissingRow,
  type DataPage,
  type DataPath,
  type DataRow,
  type DataRowAt,
  fnv1a,
  FULL_STRING_MAX,
  insertModeFor,
  isReadonlyPath,
  KEYS_CACHE_MS,
  needsConfirm,
  PAGE_SIZE,
  pathLabels,
  presetLockFor,
  presetLockLabel,
  PREVIEW_CHARS,
  ROWS_MAX,
  SIG_MAX_KEYS,
} from '@/lib/game/save-data'

import { Cheats } from '../../runtime/cheats'
import { oidOf } from './identity'
import { isPathLocked } from './locks'
import { liveNames } from './names'
import { childKeys, isTraversable, resolve, resolveContainer } from './resolve'
import { checkGen, configKeys, currentGen, isReady } from './roots'

/** Fingerprint of a container's keys and child identities; skipped for large containers */
export function keySignature(obj: object): number | undefined {
  const keys = Array.isArray(obj) ? null : Object.keys(obj)
  const size = keys ? keys.length : (obj as unknown[]).length
  if (size > SIG_MAX_KEYS) return undefined
  const rec = obj as Record<string, unknown>
  const parts: string[] = []
  const at = (key: string) => {
    const desc = keys ? Object.getOwnPropertyDescriptor(rec, key) : undefined
    if (desc && (desc.get || desc.set)) return parts.push(key, 'accessor')
    const v = rec[key]
    parts.push(key, v != null && typeof v === 'object' ? `o${oidOf(v)}` : typeof v)
  }
  if (keys) keys.forEach(at)
  else for (let i = 0; i < size; i++) at(String(i))
  return fnv1a(parts)
}

export function containerSize(obj: object): number {
  return Array.isArray(obj) ? obj.length : Object.keys(obj).length
}

export function cellOf(value: unknown, ancestors?: readonly object[]): DataCell {
  if (value === null) return { kind: 'null', value: null }
  if (value === undefined) return { kind: 'undefined' }
  switch (typeof value) {
    case 'number':
    case 'boolean':
      return { kind: typeof value as 'number' | 'boolean', value }
    case 'string':
      return value.length > PREVIEW_CHARS ? { kind: 'string', value: value.slice(0, PREVIEW_CHARS), truncated: true } : { kind: 'string', value }
    case 'object':
      break
    default:
      return { kind: 'unsupported', className: typeof value }
  }
  const obj = value as object
  const className = Object.getPrototypeOf(obj) === Object.prototype || Array.isArray(obj) ? undefined : obj.constructor?.name || undefined
  if (ancestors?.includes(obj)) return { kind: 'cycle', className, oid: oidOf(obj) }
  if (!isTraversable(obj)) return { kind: 'unsupported', className }
  return { kind: Array.isArray(obj) ? 'array' : 'object', className, size: containerSize(obj), sig: keySignature(obj), oid: oidOf(obj) }
}

/** `cellOf` plus the virtual config root (a function object with accessor fields) */
export function cellAt(path: DataPath, value: unknown, ancestors?: readonly object[]): DataCell {
  if (path.length === 1 && path[0] === 'config' && value != null) {
    const keys = configKeys()
    return { kind: 'object', className: 'ConfigManager', size: keys.length, sig: fnv1a(keys), oid: oidOf(value as object) }
  }
  return cellOf(value, ancestors)
}

/** Containers for every prefix of `path` (inclusive), or null when the path is gone */
export function containerChain(path: DataPath): object[] | null {
  const chain: object[] = []
  for (let i = 0; i <= path.length; i++) {
    const c = resolveContainer(path.slice(0, i))
    if (!c.ok) return null
    chain.push(c.obj)
  }
  return chain
}

export function buildRow(parentPath: DataPath, key: string, value: unknown, ancestors: readonly object[]): DataRow {
  const path = [...parentPath, key]
  const cell = cellAt(path, value, ancestors)
  const ann = annotate(parentPath, key, value, liveNames)
  const preset = presetLockFor(path)
  const fixedType = !!ann.expectType
  return {
    ...cell,
    key,
    label: ann.label,
    labelKey: ann.labelKey,
    expectType: ann.expectType,
    nullable: ann.nullable ?? !fixedType,
    readonly: isReadonlyPath(path) || undefined,
    confirm: needsConfirm(path) || undefined,
    presetLock: preset && Cheats.isLocked(preset.kind, preset.id) ? presetLockLabel(preset) : undefined,
    locked: isPathLocked(path) || undefined,
  }
}

export function labelsOf(path: DataPath): (string | null)[] {
  return pathLabels(path, liveNames, (prefix) => {
    const r = resolve(prefix)
    return r.exists ? r.value : undefined
  })
}

export function ensureReady() {
  checkGen()
  if (!isReady()) throw new DataError('请先读档进游戏', 'not-ready')
}

type KeysEntry = { keys: string[]; size: number; at: number }
const keysCache = new Map<number, KeysEntry>()

export function invalidateKeys(oid?: number) {
  if (oid == null) keysCache.clear()
  else keysCache.delete(oid)
}

function cachedKeys(path: DataPath, obj: object, oid: number): string[] {
  const now = Date.now()
  const size = containerSize(obj)
  const hit = keysCache.get(oid)
  if (hit && now - hit.at < KEYS_CACHE_MS && hit.size === size) return hit.keys
  const keys = childKeys(path, obj)
  if (keysCache.size > 64) keysCache.clear()
  keysCache.set(oid, { keys, size, at: now })
  return keys
}

export function listLevel(path: DataPath, offset = 0, limit = PAGE_SIZE): DataPage {
  ensureReady()
  const chain = containerChain(path)
  if (!chain) {
    const c = resolveContainer(path)
    throw new DataError('路径不存在', 'missing', c.ok ? path.length : c.existingDepth)
  }
  const obj = chain[chain.length - 1]
  const oid = oidOf(obj)
  const keys = cachedKeys(path, obj, oid)
  const start = Math.max(0, Math.floor(offset) || 0)
  const count = Math.min(PAGE_SIZE, Math.max(1, Math.floor(limit) || PAGE_SIZE))
  const rows: DataRow[] = []
  for (const key of keys.slice(start, start + count)) {
    const r = resolve([...path, key])
    rows.push(buildRow(path, key, r.exists ? r.value : undefined, chain))
  }
  const insertMode = insertModeFor(path)
  const top = path.length ? cellAt(path, obj) : null
  return {
    path,
    gen: currentGen(),
    oid,
    kind: Array.isArray(obj) ? 'array' : 'object',
    className: top?.className,
    total: keys.length,
    offset: start,
    rows,
    labels: labelsOf(path),
    canInsert: insertMode != null,
    insertMode: insertMode ?? undefined,
  }
}

export function rowAt(path: DataPath): DataRowAt | DataMissingRow {
  const r = resolve(path)
  const chain = r.exists ? containerChain(r.parentPath) : null
  if (!r.exists || !chain) return { path, missing: true }
  return { ...buildRow(r.parentPath, r.key, r.value, chain), path, ownerOid: r.ownerOid, labels: labelsOf(path) }
}

export function rowsAt(paths: DataPath[]): (DataRowAt | DataMissingRow)[] {
  ensureReady()
  return paths.slice(0, ROWS_MAX).map(rowAt)
}

export function readFull(path: DataPath): DataCell {
  ensureReady()
  const r = resolve(path)
  if (!r.exists) throw new DataError('路径不存在', 'missing', r.existingDepth)
  if (typeof r.value !== 'string') throw new DataError('只能读取文本字段的全文', 'invalid')
  if (r.value.length > FULL_STRING_MAX) throw new DataError('文本过长，无法编辑', 'invalid')
  return { kind: 'string', value: r.value }
}
