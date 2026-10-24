import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type StorageDaemonMeta = {
  instanceId: string
  pid: number
  startedAt: number
  port: number
  authToken: string
  protocolVersion: number
  dataDir: string
}

export type StorageDaemonLockHandle = {
  meta: StorageDaemonMeta
  publishPort(port: number): void
  release(): void
}

/** Check if a process ID is currently alive in the OS */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // EPERM means process exists but we lack permission to send signals
    return code !== 'ESRCH'
  }
}

function readMetaSafe(file: string): StorageDaemonMeta | null {
  try {
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StorageDaemonMeta>
    if (
      raw &&
      Number.isInteger(raw.pid) &&
      typeof raw.startedAt === 'number' &&
      typeof raw.port === 'number' &&
      typeof raw.authToken === 'string' &&
      typeof raw.dataDir === 'string'
    ) {
      return raw as StorageDaemonMeta
    }
    return null
  } catch {
    return null
  }
}

/** Read active daemon metadata if lock holder is alive */
export function readStorageDaemonMeta(dataDir?: string): StorageDaemonMeta | null {
  const resolvedDir = typeof dataDir === 'string' && dataDir ? dataDir : path.join(process.cwd(), 'data')
  const metaFile = path.join(resolvedDir, 'runtime', 'storage-daemon.json')
  const lockFile = path.join(resolvedDir, 'runtime', 'storage-daemon.lock')
  const meta = readMetaSafe(metaFile)
  const owner = readMetaSafe(lockFile)
  if (!meta || !owner || !meta.instanceId || meta.instanceId !== owner.instanceId) return null
  if (!isPidAlive(meta.pid)) return null
  return meta
}

/**
 * Acquire exclusive lock for the local storage daemon on dataDir.
 * Prevents multiple daemons from opening SQLite and writing simultaneously.
 */
export function acquireStorageDaemonLock(options: { dataDir: string; port: number; authToken: string; protocolVersion?: number; pid?: number }): StorageDaemonLockHandle | null {
  fs.mkdirSync(options.dataDir, { recursive: true, mode: 0o700 })
  const resolvedDataDir = fs.realpathSync(options.dataDir)
  const runtimeDir = path.join(resolvedDataDir, 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })

  const lockFile = path.join(runtimeDir, 'storage-daemon.lock')
  const metaFile = path.join(runtimeDir, 'storage-daemon.json')
  const currentPid = options.pid ?? process.pid
  const meta: StorageDaemonMeta = {
    instanceId: randomUUID(),
    pid: currentPid,
    startedAt: Date.now(),
    port: options.port,
    authToken: options.authToken,
    protocolVersion: options.protocolVersion ?? 1,
    dataDir: resolvedDataDir,
  }

  // SQLite's OS-backed lock is released on process death. Never unlink this
  // guard: replacing its inode would let two processes lock different files.
  const guard = new DatabaseSync(path.join(runtimeDir, 'storage-daemon.guard.sqlite'))
  try {
    guard.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    guard.close()
    if (/locked|busy/i.test((error as Error).message)) return null
    throw error
  }

  const publish = () => {
    for (const file of [lockFile, metaFile]) {
      const temp = `${file}.${meta.instanceId}.tmp`
      try {
        fs.writeFileSync(temp, JSON.stringify(meta), { mode: 0o600, flag: 'wx' })
        fs.renameSync(temp, file)
      } finally {
        fs.rmSync(temp, { force: true })
      }
    }
  }
  try {
    const existing = readMetaSafe(lockFile)
    // Respect a daemon from the previous O_EXCL protocol during transition.
    if (existing && !existing.instanceId && isPidAlive(existing.pid)) {
      guard.close()
      return null
    }
    publish()
  } catch (error) {
    guard.close()
    throw error
  }
  let released = false
  return {
    meta,
    publishPort(port) {
      if (released) throw new Error('Storage daemon lock has been released')
      meta.port = port
      publish()
    },
    release() {
      if (released) return
      released = true
      try {
        const owner = readMetaSafe(lockFile)
        if (owner?.instanceId === meta.instanceId) {
          fs.rmSync(lockFile, { force: true })
          fs.rmSync(metaFile, { force: true })
        }
      } finally {
        guard.close()
      }
    },
  }
}
