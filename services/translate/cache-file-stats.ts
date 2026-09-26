import fs from 'node:fs'
import { stat } from 'node:fs/promises'

import { gameContentCandidatePaths } from '@/lib/game'

type Stats = { entries: number; file: string | null; sizeBytes: number }
type Entry = { value: Stats; checkedAt: number; fingerprint: string; pending: boolean }
const stats = new Map<string, Entry>()

/** 轮询返回已有统计，异步按流计数，文件未变时复用结果。 */
export function gameCacheFileStats(contentRoot: string): Stats {
  let entry = stats.get(contentRoot)
  if (!entry) {
    entry = { value: { entries: 0, file: null, sizeBytes: 0 }, checkedAt: 0, fingerprint: '', pending: false }
    if (stats.size >= 100) {
      const oldest = [...stats].find(([, item]) => !item.pending)
      if (oldest) stats.delete(oldest[0])
    }
    stats.set(contentRoot, entry)
  }
  if (!entry.pending && Date.now() - entry.checkedAt > 5_000) {
    entry.pending = true
    void refresh(contentRoot, entry)
      .catch(() => {})
      .finally(() => {
        entry.pending = false
        entry.checkedAt = Date.now()
      })
  }
  return { ...entry.value }
}

async function refresh(contentRoot: string, entry: Entry) {
  for (const file of gameContentCandidatePaths(contentRoot, 'cacheNdjson', { alsoParent: true })) {
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) continue
    const fingerprint = `${file}:${info.mtimeMs}:${info.size}`
    if (fingerprint === entry.fingerprint) return
    let entries = 0
    const stream = fs.createReadStream(file, { encoding: 'utf8' })
    let remainder = ''
    try {
      for await (const chunk of stream) {
        const lines = (remainder + String(chunk)).split('\n')
        remainder = lines.pop() || ''
        for (const line of lines) if (line.trim()) entries++
      }
      if (remainder.trim()) entries++
    } finally {
      stream.destroy()
    }
    entry.value = { entries, file, sizeBytes: info.size }
    entry.fingerprint = fingerprint
    return
  }
  entry.value = { entries: 0, file: null, sizeBytes: 0 }
  entry.fingerprint = ''
}
