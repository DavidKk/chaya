/**
 * Save data service: the single entry used by the link bridge (web page) and the overlay.
 * Undo stack, locks, pins and the generation are shared; each client owns its watcher and search.
 */
import {
  type DataCell,
  DataError,
  type DataMissingRow,
  type DataOp,
  type DataPage,
  type DataPath,
  type DataRowAt,
  type DataStatus,
  type DataWriteResult,
  isFixedList,
  isReadonlyPath,
  isValidPath,
  presetLockFor,
  type SearchBatch,
  type SearchScope,
} from '@/lib/game/save-data'

import { Cheats } from '../../runtime/cheats'
import { clearDataLocks, disposeLocks, lockList, removeDataLock, setDataLock } from './locks'
import { getPins, setPins } from './pins'
import { cellOf, ensureReady, invalidateKeys, labelsOf, listLevel, readFull, rowsAt } from './read'
import { resolve } from './resolve'
import { checkGen, currentGen, isReady, onGenChange } from './roots'
import { startSearch } from './search'
import { markStatusChanged, onStatusChange } from './status'
import { applyStruct } from './struct'
import { clearUndo, undo, undoDepth, undoSummary } from './undo'
import { createWatcher, type Watcher } from './watch'
import { applyWrites } from './write'

onGenChange(() => {
  clearUndo()
  clearDataLocks()
  invalidateKeys()
  markStatusChanged()
})

type LockOp = Extract<DataOp, { op: 'dataLock' }>

function lock(op: LockOp): DataWriteResult | DataCell | undefined {
  if (!isValidPath(op.path)) throw new DataError('路径无效', 'invalid')
  if (!op.on) {
    removeDataLock(op.path)
    return undefined
  }
  ensureReady()
  const r = resolve(op.path)
  if (!r.exists) throw new DataError('字段已不存在', 'missing', r.existingDepth)
  if (r.ownerOid !== op.ownerOid) throw new DataError('所属对象已变化', 'stale')
  if (isReadonlyPath(op.path)) throw new DataError('该字段只读', 'readonly')
  const preset = presetLockFor(op.path)
  if (preset && Cheats.isLocked(preset.kind, preset.id)) throw new DataError('已被修改页的锁定占用', 'preset-lock')

  let result: DataWriteResult | DataCell
  let value: unknown
  if (op.value !== undefined) {
    if (op.value === null) throw new DataError('不能锁定为空值', 'type')
    const [written] = applyWrites([{ path: op.path, ownerOid: op.ownerOid, type: op.valueType ?? (typeof op.value as 'number'), value: op.value, confirmed: op.confirmed }])
    if (!written?.ok) return written
    result = written
    const after = resolve(op.path)
    value = after.exists ? after.value : undefined
  } else {
    value = r.value
    if (value === undefined && isFixedList(op.path.slice(0, -1))) value = op.path[0] === 'switches' ? false : 0
    result = cellOf(value)
  }
  if (value === null || value === undefined || typeof value === 'object') throw new DataError('只能锁定数字、文本或开关值', 'type')
  setDataLock({ path: op.path, ownerOid: op.ownerOid, value: value as string | number | boolean, label: labelsOf(op.path).at(-1) ?? undefined })
  return result
}

export const SaveData = {
  list(path: DataPath, offset: number, limit: number): DataPage {
    return listLevel(path, offset, limit)
  },
  read(path: DataPath): DataCell {
    return readFull(path)
  },
  rows(paths: DataPath[]): (DataRowAt | DataMissingRow)[] {
    return rowsAt(paths)
  },
  createWatcher,
  search(path: DataPath, query: string, scope: SearchScope, onBatch: (batch: SearchBatch) => void): () => void {
    return startSearch(path, query, scope, onBatch)
  },
  status(): DataStatus {
    checkGen()
    return { gen: currentGen(), ready: isReady(), undo: undoSummary(), undoDepth: undoDepth(), locks: lockList(), pins: getPins() }
  },
  onStatus: onStatusChange,
  run(op: DataOp): unknown {
    switch (op.op) {
      case 'dataWrite':
        return applyWrites(op.items)
      case 'dataStruct':
        return applyStruct(op)
      case 'dataLock':
        return lock(op)
      case 'dataUnlockAll':
        clearDataLocks()
        return undefined
      case 'dataUndo':
        ensureReady()
        return undo(!!op.force)
      case 'dataPins':
        setPins(op.pins)
        return undefined
      default:
        throw new DataError('未知操作', 'invalid')
    }
  },
  /** Poll the generation without a watcher (status requests call this too) */
  checkGen,
  dispose() {
    disposeLocks()
    clearUndo()
  },
}

export type { Watcher }
