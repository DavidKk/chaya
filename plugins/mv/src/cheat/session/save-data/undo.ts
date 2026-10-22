/** Undo stack shared by every client; each entry is one apply (a batch write or one structure change) */
import { type DataCell, type DataPath, type DataUndoResult, type DataUndoSummary, type PrimitiveValue, samePrimitive, UNDO_MAX } from '@/lib/game/save-data'

import { dropLocksFrom, syncLockValue } from './locks'
import { cellOf, invalidateKeys, labelsOf } from './read'
import { resolve, resolveContainer } from './resolve'
import { markStatusChanged } from './status'
import { refreshKeyFor, runRefreshes, writeValue } from './writers'

export type SetStep = {
  t: 'set'
  path: DataPath
  ownerOid: number
  before: { exists: boolean; value: PrimitiveValue | undefined }
  after: PrimitiveValue | undefined
}

export type StructStep =
  | { t: 'insert'; path: DataPath; ownerOid: number; index: number; element: unknown }
  | {
      t: 'remove'
      path: DataPath
      ownerOid: number
      index: number
      element: unknown
      expectedLength: number
      previous: { exists: boolean; value?: unknown }
      next: { exists: boolean; value?: unknown }
    }
  | { t: 'addKey'; path: DataPath; ownerOid: number; key: string; value: PrimitiveValue }
  | { t: 'removeKey'; path: DataPath; ownerOid: number; key: string; value: unknown }

export type UndoStep = SetStep | StructStep

type Entry = { kind: 'write' | 'struct'; steps: UndoStep[]; summary: DataUndoSummary }

const stack: Entry[] = []

const lastLabel = (path: DataPath) => labelsOf(path).at(-1) ?? undefined

const cellOfOptional = (value: unknown, exists: boolean): DataCell => (exists ? cellOf(value) : { kind: 'undefined' })

function summarize(kind: 'write' | 'struct', steps: UndoStep[]): DataUndoSummary {
  const first = steps[0]
  if (!first) return { count: 0, kind, first: null }
  if (first.t === 'set') {
    return {
      count: steps.length,
      kind,
      first: { path: first.path, label: lastLabel(first.path), before: cellOfOptional(first.before.value, first.before.exists), after: cellOf(first.after) },
    }
  }
  const target = structTarget(first)
  const none: DataCell = { kind: 'undefined' }
  const label = lastLabel(target)
  switch (first.t) {
    case 'insert':
      return { count: steps.length, kind, first: { path: target, label, before: none, after: cellOf(first.element) } }
    case 'addKey':
      return { count: steps.length, kind, first: { path: target, label, before: none, after: cellOf(currentValue(target)) } }
    case 'remove':
      return { count: steps.length, kind, first: { path: target, label, before: cellOf(first.element), after: none } }
    case 'removeKey':
      return { count: steps.length, kind, first: { path: target, label, before: cellOf(first.value), after: none } }
  }
}

function structTarget(step: StructStep): DataPath {
  return [...step.path, step.t === 'addKey' || step.t === 'removeKey' ? step.key : String(step.index)]
}

export function pushUndo(kind: 'write' | 'struct', steps: UndoStep[]) {
  if (!steps.length) return
  stack.push({ kind, steps, summary: summarize(kind, steps) })
  if (stack.length > UNDO_MAX) stack.shift()
  markStatusChanged()
}

export function clearUndo() {
  if (!stack.length) return
  stack.length = 0
  markStatusChanged()
}

export function undoSummary(): DataUndoSummary | null {
  return stack.at(-1)?.summary ?? null
}

export function undoDepth(): number {
  return stack.length
}

function ownerOidOf(step: UndoStep): number | null {
  const c = resolveContainer(step.t === 'set' ? step.path.slice(0, -1) : step.path)
  return c.ok ? c.oid : null
}

function structStillValid(step: StructStep): boolean {
  const c = resolveContainer(step.path)
  if (!c.ok) return false
  const obj = c.obj as Record<string, unknown> & unknown[]
  switch (step.t) {
    case 'insert': {
      if (!Array.isArray(obj) || step.index >= obj.length) return false
      const now = obj[step.index]
      return now === step.element || samePrimitive(now, step.element)
    }
    case 'remove':
      if (!Array.isArray(obj) || obj.length !== step.expectedLength) return false
      return sameOptional(obj, step.index - 1, step.previous) && sameOptional(obj, step.index, step.next)
    case 'addKey':
      return Object.prototype.hasOwnProperty.call(obj, step.key) && samePrimitive(obj[step.key], step.value)
    case 'removeKey':
      return !Object.prototype.hasOwnProperty.call(obj, step.key)
  }
}

function sameOptional(obj: unknown[], index: number, expected: { exists: boolean; value?: unknown }): boolean {
  const exists = index >= 0 && index < obj.length
  if (exists !== expected.exists) return false
  return !exists || obj[index] === expected.value || samePrimitive(obj[index], expected.value)
}

function currentValue(path: DataPath): unknown {
  const r = resolve(path)
  return r.exists ? r.value : undefined
}

function revertStruct(step: StructStep): string | null {
  const c = resolveContainer(step.path)
  if (!c.ok) return null
  const obj = c.obj as Record<string, unknown> & unknown[]
  if (step.t === 'insert') obj.splice(step.index, 1)
  else if (step.t === 'remove') obj.splice(step.index, 0, step.element)
  else if (step.t === 'addKey') delete obj[step.key]
  else obj[step.key] = step.value
  invalidateKeys(c.oid)
  if (step.t === 'insert' || step.t === 'remove') dropLocksFrom(step.path, step.index)
  return refreshKeyFor(structTarget(step))
}

export function undo(force = false): DataUndoResult {
  const entry = stack.at(-1)
  if (!entry) return { applied: false, reason: 'empty' }

  for (const step of entry.steps) {
    if (ownerOidOf(step) !== step.ownerOid) {
      stack.pop()
      markStatusChanged()
      return { applied: false, reason: 'replaced' }
    }
    if (step.t !== 'set' && !structStillValid(step)) {
      stack.pop()
      markStatusChanged()
      return { applied: false, reason: 'struct-moved' }
    }
  }

  const conflicts: NonNullable<DataUndoResult['conflicts']> = []
  for (const step of entry.steps) {
    if (step.t !== 'set') continue
    const now = currentValue(step.path)
    if (!samePrimitive(now, step.after)) conflicts.push({ path: step.path, label: lastLabel(step.path), current: cellOf(now) })
  }
  if (conflicts.length && !force) return { applied: false, conflicts }

  const refreshes: (string | null)[] = []
  for (const step of [...entry.steps].reverse()) {
    if (step.t !== 'set') {
      refreshes.push(revertStruct(step))
      continue
    }
    const parent = resolveContainer(step.path.slice(0, -1))
    if (!parent.ok) continue
    const key = step.path[step.path.length - 1]
    refreshes.push(writeValue(step.path, parent.obj, key, step.before.value, !step.before.exists).refresh)
    if (!step.before.exists) invalidateKeys(parent.oid)
    syncLockValue(step.path, step.before.value)
  }
  runRefreshes(refreshes)
  stack.pop()
  markStatusChanged()
  return { applied: true }
}
