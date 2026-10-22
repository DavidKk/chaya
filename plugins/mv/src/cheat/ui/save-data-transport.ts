/** Overlay data page: calls the save data service directly (same process), with its own watcher */
import type { SaveDataTransport } from '@/components/game-edit/save-data/transport'
import type { DataDiff, DataStatus } from '@/lib/game/save-data'

import { SaveData, type Watcher } from '../session/save-data'

export function createDirectTransport(): SaveDataTransport & { dispose(): void } {
  const diffSubs = new Set<(diff: DataDiff) => void>()
  const statusSubs = new Set<(status: DataStatus) => void>()
  const searchCancels = new Set<() => void>()
  let watcher: Watcher | null = null
  let disposed = false

  const pushStatus = () => {
    if (disposed) return
    const status = SaveData.status()
    for (const cb of statusSubs) cb(status)
  }
  const offStatus = SaveData.onStatus(pushStatus)

  const later = <T>(fn: () => T): Promise<T> =>
    new Promise((resolve, reject) => {
      try {
        resolve(fn())
      } catch (err) {
        reject(err)
      }
    })

  return {
    list: (path, offset, limit) => later(() => SaveData.list(path, offset, limit)),
    read: (path) => later(() => SaveData.read(path)),
    rows: (paths) => later(() => SaveData.rows(paths)),
    watch(sid, entries) {
      if (!watcher) watcher = SaveData.createWatcher((diff) => diffSubs.forEach((cb) => cb(diff)))
      watcher.set(sid, entries)
    },
    onDiff(cb) {
      diffSubs.add(cb)
      return () => diffSubs.delete(cb)
    },
    onStatus(cb) {
      statusSubs.add(cb)
      return () => statusSubs.delete(cb)
    },
    requestStatus: () => queueMicrotask(pushStatus),
    search: (path, query, scope, onBatch) => {
      if (disposed) return () => {}
      let cancelService = () => {}
      let finished = false
      const cancel = () => {
        if (finished) return
        finished = true
        searchCancels.delete(cancel)
        cancelService()
      }
      try {
        cancelService = SaveData.search(path, query, scope, (batch) => {
          if (finished || disposed) return
          onBatch(batch)
          if (batch.done) {
            finished = true
            searchCancels.delete(cancel)
          }
        })
        if (!finished) searchCancels.add(cancel)
        return cancel
      } catch {
        if (!disposed) onBatch({ hits: [], done: true, truncated: false, scanned: 0 })
        return () => {}
      }
    },
    run: (op) => later(() => SaveData.run(op)),
    dispose() {
      disposed = true
      for (const cancel of [...searchCancels]) cancel()
      offStatus()
      watcher?.dispose()
      watcher = null
      diffSubs.clear()
      statusSubs.clear()
    },
  }
}
