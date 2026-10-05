import type { DataCell, DataDiff, DataMissingRow, DataOp, DataPage, DataPath, DataRowAt, DataStatus, SearchBatch, SearchScope, WatchEntry } from '@/lib/game/save-data'

/**
 * How the data page talks to the game: the web page goes over the link, the overlay calls the plugin directly.
 * Failures reject with `DataError` (carrying `code` / `existingDepth` when the game gave them).
 */
export type SaveDataTransport = {
  list(path: DataPath, offset: number, limit: number): Promise<DataPage>
  read(path: DataPath): Promise<DataCell>
  rows(paths: DataPath[]): Promise<(DataRowAt | DataMissingRow)[]>
  /** Replaces the subscription; empty entries stop it */
  watch(sid: number, entries: WatchEntry[]): void
  onDiff(cb: (diff: DataDiff) => void): () => void
  onStatus(cb: (status: DataStatus) => void): () => void
  requestStatus(): void
  /** Returns a cancel function */
  search(path: DataPath, query: string, scope: SearchScope, onBatch: (batch: SearchBatch) => void): () => void
  /** Write-side ops; resolves with the op result */
  run(op: DataOp): Promise<unknown>
}

/** Data page wiring from the host (web page or overlay) */
export type DataRootView = 'pins' | 'all'

export type SaveDataSlot = {
  /** null: not linked to a game */
  transport: SaveDataTransport | null
  path: DataPath
  /** Root level shows pinned fields or every top-level entry (default pins) */
  rootView?: DataRootView
  /** `root` picks the root view when `path` is empty */
  onNavigate: (path: DataPath, opts?: { replace?: boolean; root?: DataRootView }) => void
  surface: 'page' | 'overlay'
}
