import { execFile } from 'node:child_process'
import fs from 'node:fs'

const TTL_MS = 5 * 60_000
const sizes = new Map<string, { bytes: number | null; expiresAt: number; pending: boolean }>()

/** 返回上次结果，过期时后台刷新；状态轮询不会等待目录遍历。 */
export function measureDirSizeBytes(dir: string): number | null {
  if (!dir || !fs.existsSync(dir)) {
    sizes.delete(dir)
    return null
  }
  const previous = sizes.get(dir)
  if (previous?.pending || (previous && previous.expiresAt > Date.now())) return previous.bytes
  const entry = { bytes: previous?.bytes ?? null, expiresAt: 0, pending: true }
  if (sizes.size >= 100) {
    const oldest = [...sizes].find(([, item]) => !item.pending)
    if (oldest) sizes.delete(oldest[0])
  }
  sizes.set(dir, entry)
  execFile('du', ['-sk', dir], { encoding: 'utf8', timeout: 12_000, maxBuffer: 1024 * 1024 }, (error, out) => {
    const kb = error ? NaN : Number.parseInt(String(out).trim().split(/\s+/)[0] || '', 10)
    entry.bytes = Number.isFinite(kb) && kb >= 0 ? kb * 1024 : null
    entry.pending = false
    entry.expiresAt = Date.now() + TTL_MS
  })
  return entry.bytes
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  const digits = n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2
  return `${n.toFixed(digits)} ${units[i]}`
}
