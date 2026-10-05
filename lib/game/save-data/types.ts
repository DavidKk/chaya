/** Path from a root field, e.g. `['party', '_items', '12']`; array indexes are strings too */
export type DataPath = string[]

export type DataKind = 'number' | 'string' | 'boolean' | 'null' | 'undefined' | 'object' | 'array' | 'unsupported' | 'cycle'

export type ValueType = 'number' | 'string' | 'boolean' | 'null'

export type PrimitiveValue = string | number | boolean | null

/** Type a known structure fixes for its values; `number|string` defaults to number */
export type ExpectType = ValueType | 'number|string'

/** One field at one moment: primitives carry `value`, containers a summary */
export type DataCell = {
  kind: DataKind
  value?: PrimitiveValue
  /** String cut to the preview length; read the full text before editing */
  truncated?: boolean
  className?: string
  size?: number
  sig?: number
  oid?: number
}

export type RefreshKind = 'map' | 'actor' | 'actor-party' | 'config'

export type DataRow = DataCell & {
  key: string
  /** Name from game data (translated), e.g. a switch or actor name */
  label?: string
  /** UI message key (config entries) */
  labelKey?: string
  expectType?: ExpectType
  /** Whether "set to empty" is offered */
  nullable?: boolean
  readonly?: boolean
  confirm?: boolean
  /** Already locked by a preset lock (gold / var / sw / hp…); shown, not lockable here */
  presetLock?: string
  locked?: boolean
}

/** A row returned outside a page (pins, search hits) */
export type DataRowAt = DataRow & { path: DataPath; ownerOid: number; labels: (string | null)[] }

export type DataMissingRow = { path: DataPath; missing: true }

export type InsertMode = 'value' | 'item' | 'selfSwitch'

export type DataPage = {
  path: DataPath
  gen: number
  oid: number
  kind: 'object' | 'array'
  className?: string
  total: number
  offset: number
  rows: DataRow[]
  /** Labels for each segment of `path` (breadcrumb) */
  labels: (string | null)[]
  canInsert: boolean
  insertMode?: InsertMode
}

export type DataErrorCode = 'missing' | 'not-ready' | 'stale' | 'readonly' | 'confirm' | 'type' | 'invalid' | 'preset-lock' | 'unsupported'

export type DataWriteItem = { path: DataPath; ownerOid: number; type: ValueType; value: PrimitiveValue; confirmed?: boolean }

export type DataWriteResult = { path: DataPath; ok: boolean; readback?: DataCell; error?: string; code?: DataErrorCode }

export type DataStructAction = 'insert' | 'copy' | 'remove' | 'addKey' | 'removeKey'

export type DataStructResult = { path: DataPath; index?: number }

export type DataUndoSummary = {
  count: number
  kind: 'write' | 'struct'
  first: { path: DataPath; label?: string; before: DataCell; after: DataCell } | null
}

export type DataUndoResult = {
  applied: boolean
  reason?: 'replaced' | 'struct-moved' | 'empty'
  conflicts?: { path: DataPath; label?: string; current: DataCell }[]
}

export type DataLockInfo = { path: DataPath; label?: string; value: PrimitiveValue }

export type DataPin = { path: DataPath; label?: string }

export type DataStatus = {
  gen: number
  ready: boolean
  undo: DataUndoSummary | null
  undoDepth: number
  locks: DataLockInfo[]
  pins: DataPin[]
}

export type WatchEntry = { path: DataPath; oid?: number; ownerOid?: number }

export type DataDiff = { sid: number; gen: number; changes: { path: DataPath; cell: DataCell }[]; replaced?: DataPath[] }

export type SearchScope = 'all' | 'name' | 'value'

export type SearchBatch = { hits: DataRowAt[]; done: boolean; truncated: boolean; scanned: number }

/** Write-side operations; sent as `edit.cmd` ops over the link */
export type DataOp =
  | { op: 'dataWrite'; items: DataWriteItem[] }
  | {
      op: 'dataStruct'
      path: DataPath
      ownerOid: number
      action: DataStructAction
      index?: number
      key?: string
      from?: number
      valueType?: ValueType
      value?: PrimitiveValue
      confirmed?: boolean
    }
  | { op: 'dataLock'; path: DataPath; ownerOid: number; on: boolean; value?: PrimitiveValue; valueType?: ValueType; confirmed?: boolean }
  | { op: 'dataUnlockAll' }
  | { op: 'dataUndo'; force?: boolean }
  | { op: 'dataPins'; pins: DataPin[] }

const DATA_OPS = new Set<string>(['dataWrite', 'dataStruct', 'dataLock', 'dataUnlockAll', 'dataUndo', 'dataPins'])

export function isDataOp(op: { op: string }): op is DataOp {
  return DATA_OPS.has(op.op)
}

export class DataError extends Error {
  constructor(
    message: string,
    readonly code?: DataErrorCode,
    readonly existingDepth?: number
  ) {
    super(message)
    this.name = 'DataError'
  }
}
