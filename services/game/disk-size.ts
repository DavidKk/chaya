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

export { formatBytes } from '@/lib/format-bytes'
