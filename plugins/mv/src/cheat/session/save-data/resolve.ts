/**
 * Path → runtime location. Only own data properties are followed (the config root reads its accessors);
 * switch / variable indexes up to the database count exist even when the engine has not stored them yet.
 */
import { DATA_ROOTS, type DataPath, isFixedList, isRootKey, isValidPath, itemBagOf, itemKindOfBag, parseSelfSwitchKey } from '@/lib/game/save-data'

import { oidOf } from './identity'
import { configKeys, rootObject } from './roots'

/** Owner of the root fields (the first level of the page) */
export const ROOT_LIST: object = Object.freeze({})

export type Resolved = { exists: true; owner: object; key: string; value: unknown; ownerOid: number; parentPath: DataPath } | { exists: false; existingDepth: number }

export type Container = { ok: true; obj: object; oid: number } | { ok: false; existingDepth: number }

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

export function fixedListCount(root: 'switches' | 'variables'): number {
  const list = (globalThis as { $dataSystem?: { switches?: unknown[]; variables?: unknown[] } }).$dataSystem?.[root]
  return Array.isArray(list) ? Math.max(0, list.length - 1) : 0
}

const UNSUPPORTED = [globalThis.Map, globalThis.Set, globalThis.WeakMap, globalThis.WeakSet, globalThis.Date, globalThis.RegExp, globalThis.Promise].filter(Boolean)

/** Objects we list and descend into: plain objects, class instances and arrays */
export function isTraversable(value: unknown): value is object {
  if (value == null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false
  return !UNSUPPORTED.some((C) => value instanceof C)
}

export function isConfigOwner(owner: object): boolean {
  return owner === (globalThis as { ConfigManager?: unknown }).ConfigManager
}

/** Own data property (not an accessor) */
export function isDataProperty(owner: object, key: string): boolean {
  if (!hasOwn(owner, key)) return false
  const desc = Object.getOwnPropertyDescriptor(owner, key)
  return !!desc && !desc.get && !desc.set
}

/**
 * Engine stores that drop entries at their default (item count 0, self switch OFF) still answer reads for those
 * keys, so a lock or pin on them survives the entry being removed.
 */
export function implicitDefault(parentPath: DataPath, key: string): { value: number | boolean } | null {
  if (parentPath.length !== 2) return null
  const [root, a] = parentPath
  if (root === 'selfSwitches' && a === '_data') return parseSelfSwitchKey(key) ? { value: false } : null
  const bag = root === 'party' ? itemBagOf(a) : null
  if (!bag || !/^[1-9]\d*$/.test(key)) return null
  const kind = itemKindOfBag(bag)
  const db = (globalThis as Record<string, unknown>)[kind === 'item' ? '$dataItems' : kind === 'weapon' ? '$dataWeapons' : '$dataArmors']
  return Array.isArray(db) && db[Number(key)] ? { value: 0 } : null
}

/** Whether `key` is a child of the container at `parentPath` */
function childExists(parentPath: DataPath, owner: object, key: string): boolean {
  if (owner === ROOT_LIST) return isRootKey(key) && rootObject(key) != null
  if (!hasOwn(owner, key) && implicitDefault(parentPath, key)) return true
  if (parentPath.length === 1 && parentPath[0] === 'config') return configKeys().includes(key)
  if (Array.isArray(owner)) {
    if (!/^(0|[1-9]\d*)$/.test(key)) return false
    const i = Number(key)
    if (i < owner.length) return true
    if (isFixedList(parentPath)) return i >= 1 && i <= fixedListCount(parentPath[0] as 'switches' | 'variables')
    return false
  }
  return isDataProperty(owner, key) && typeof (owner as Record<string, unknown>)[key] !== 'function'
}

export function childValue(parentPath: DataPath, owner: object, key: string): unknown {
  if (owner === ROOT_LIST) return isRootKey(key) ? rootObject(key) : undefined
  if (!hasOwn(owner, key)) {
    const fallback = implicitDefault(parentPath, key)
    if (fallback) return fallback.value
  }
  return (owner as Record<string, unknown>)[key]
}

/** The container at `path` (root list for `[]`, `ConfigManager` for `['config']`) */
export function resolveContainer(path: DataPath): Container {
  if (!isValidPath(path)) return { ok: false, existingDepth: 0 }
  let obj: object = ROOT_LIST
  for (let i = 0; i < path.length; i++) {
    const key = path[i]
    if (!childExists(path.slice(0, i), obj, key)) return { ok: false, existingDepth: i }
    const value = childValue(path.slice(0, i), obj, key)
    const isConfig = i === 0 && key === 'config'
    if (!isConfig && !isTraversable(value)) return { ok: false, existingDepth: i }
    if (isConfig && value == null) return { ok: false, existingDepth: i }
    obj = value as object
  }
  return { ok: true, obj, oid: oidOf(obj) }
}

export function resolve(path: DataPath): Resolved {
  if (!path.length) return { exists: false, existingDepth: 0 }
  const parentPath = path.slice(0, -1)
  const parent = resolveContainer(parentPath)
  if (!parent.ok) return { exists: false, existingDepth: parent.existingDepth }
  const key = path[path.length - 1]
  if (!childExists(parentPath, parent.obj, key)) return { exists: false, existingDepth: parentPath.length }
  return { exists: true, owner: parent.obj, key, value: childValue(parentPath, parent.obj, key), ownerOid: parent.oid, parentPath }
}

/** Child keys of a container, in display order */
export function childKeys(path: DataPath, obj: object): string[] {
  if (obj === ROOT_LIST) return path.length ? [] : rootKeysPresent()
  if (path.length === 1 && path[0] === 'config') return configKeys()
  if (Array.isArray(obj)) {
    const n = isFixedList(path) ? Math.max(obj.length, fixedListCount(path[0] as 'switches' | 'variables') + 1) : obj.length
    const start = isFixedList(path) ? 1 : 0
    const out: string[] = []
    for (let i = start; i < n; i++) out.push(String(i))
    return out
  }
  return Object.keys(obj).filter((k) => isDataProperty(obj, k) && typeof (obj as Record<string, unknown>)[k] !== 'function')
}

function rootKeysPresent(): string[] {
  return DATA_ROOTS.map(([k]) => k).filter((k) => rootObject(k) != null)
}
