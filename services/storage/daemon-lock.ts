import fs from 'node:fs'
import path from 'node:path'

export type StorageDaemonMeta = {
  pid: number
  startedAt: number
  port: number
  authToken: string
  protocolVersion: number
  dataDir: string
}

export type StorageDaemonLockHandle = {
  meta: StorageDaemonMeta
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
    return code === 'EPERM'
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
export function readStorageDaemonMeta(dataDir: string): StorageDaemonMeta | null {
  const metaFile = path.join(dataDir, 'runtime', 'storage-daemon.json')
  const lockFile = path.join(dataDir, 'runtime', 'storage-daemon.lock')
  const meta = readMetaSafe(metaFile) || readMetaSafe(lockFile)
  if (!meta) return null
  if (!isPidAlive(meta.pid)) return null
  return meta
}

/**
 * Acquire exclusive lock for the local storage daemon on dataDir.
 * Prevents multiple daemons from opening SQLite and writing simultaneously.
 */
export function acquireStorageDaemonLock(options: { dataDir: string; port: number; authToken: string; protocolVersion?: number; pid?: number }): StorageDaemonLockHandle | null {
  const resolvedDataDir = path.resolve(options.dataDir)
  const runtimeDir = path.join(resolvedDataDir, 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })

  const lockFile = path.join(runtimeDir, 'storage-daemon.lock')
  const metaFile = path.join(runtimeDir, 'storage-daemon.json')
  const currentPid = options.pid ?? process.pid
  const meta: StorageDaemonMeta = {
    pid: currentPid,
    startedAt: Date.now(),
    port: options.port,
    authToken: options.authToken,
    protocolVersion: options.protocolVersion ?? 1,
    dataDir: resolvedDataDir,
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify(meta, null, 2), {
        flag: 'wx',
        mode: 0o600,
      })
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), {
        mode: 0o600,
      })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = readMetaSafe(lockFile)
      if (existing && isPidAlive(existing.pid)) {
        // Another live daemon owns the lock
        return null
      }
      // Stale or dead lock; clean up and retry once
      try {
        fs.rmSync(lockFile, { force: true })
        fs.rmSync(metaFile, { force: true })
      } catch {
        return null
      }
    }
  }

  let released = false
  return {
    meta,
    release() {
      if (released) return
      released = true
      try {
        const owner = readMetaSafe(lockFile)
        if (owner?.pid === currentPid) {
          fs.rmSync(lockFile, { force: true })
          fs.rmSync(metaFile, { force: true })
        }
      } catch {
        /* ignore */
      }
    },
  }
}
