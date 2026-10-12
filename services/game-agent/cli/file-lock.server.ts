import fs from 'node:fs'
import path from 'node:path'

type LockOwner = { pid: number; startedAt: number }

const held = new Map<string, number>()
const STARTED_AT = Math.round(Date.now() - process.uptime() * 1000)

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readOwner(file: string): LockOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockOwner>
    return Number.isInteger(value.pid) && typeof value.startedAt === 'number' ? (value as LockOwner) : null
  } catch {
    return null
  }
}

function create(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: STARTED_AT }), { flag: 'wx', mode: 0o600 })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = readOwner(file)
      if (owner && owner.pid !== process.pid && pidAlive(owner.pid)) return false
      fs.rmSync(file, { force: true })
    }
  }
  return false
}

/**
 * Cross-process exclusive lock backed by an `O_EXCL` file. Holders inside this process share it by refcount;
 * a lock left by a dead pid is taken over. Returns null while another live process owns the file.
 */
export function holdFileLock(file: string): (() => void) | null {
  const count = held.get(file) || 0
  if (!count && !create(file)) return null
  held.set(file, count + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (held.get(file) || 1) - 1
    if (remaining > 0) {
      held.set(file, remaining)
      return
    }
    held.delete(file)
    if (readOwner(file)?.pid === process.pid) fs.rmSync(file, { force: true })
  }
}
