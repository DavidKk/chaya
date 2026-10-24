import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { acquireStorageDaemonLock, isPidAlive, readStorageDaemonMeta } from '@/services/storage/daemon-lock'

describe('daemon-lock', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-daemon-lock-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('acquires exclusive lock, permits reading meta, and releases cleanly', () => {
    const handle = acquireStorageDaemonLock({
      dataDir: tmpDir,
      port: 3927,
      authToken: 'test-token-123',
    })

    expect(handle).not.toBeNull()
    expect(handle?.meta.port).toBe(3927)
    expect(handle?.meta.authToken).toBe('test-token-123')

    const meta = readStorageDaemonMeta(tmpDir)
    expect(meta).not.toBeNull()
    expect(meta?.pid).toBe(process.pid)
    expect(meta?.port).toBe(3927)

    // Second acquire by another instance should fail
    const handle2 = acquireStorageDaemonLock({
      dataDir: tmpDir,
      port: 3928,
      authToken: 'another-token',
    })
    expect(handle2).toBeNull()

    // Release
    handle?.release()

    // After release, lock should be gone and readStorageDaemonMeta should return null
    expect(readStorageDaemonMeta(tmpDir)).toBeNull()

    // Can acquire again after release
    const handle3 = acquireStorageDaemonLock({
      dataDir: tmpDir,
      port: 3929,
      authToken: 'token-3',
    })
    expect(handle3).not.toBeNull()
    handle3?.release()
  })

  it('safely takes over orphan lock left by dead process', () => {
    const runtimeDir = path.join(tmpDir, 'runtime')
    fs.mkdirSync(runtimeDir, { recursive: true })

    // Choose a PID that is not alive
    const deadPid = 99999999
    expect(isPidAlive(deadPid)).toBe(false)

    const orphanMeta = {
      pid: deadPid,
      startedAt: Date.now() - 100000,
      port: 3999,
      authToken: 'orphan-token',
      protocolVersion: 1,
      dataDir: tmpDir,
    }
    fs.writeFileSync(path.join(runtimeDir, 'storage-daemon.lock'), JSON.stringify(orphanMeta))
    fs.writeFileSync(path.join(runtimeDir, 'storage-daemon.json'), JSON.stringify(orphanMeta))

    // Dead pid returns null for active meta
    expect(readStorageDaemonMeta(tmpDir)).toBeNull()

    // New daemon should detect dead PID and take over
    const handle = acquireStorageDaemonLock({
      dataDir: tmpDir,
      port: 3927,
      authToken: 'new-token',
    })

    expect(handle).not.toBeNull()
    expect(handle?.meta.pid).toBe(process.pid)
    handle?.release()
  })

  it('keeps the guard exclusive when metadata is corrupt and the data directory is aliased', () => {
    const owner = acquireStorageDaemonLock({ dataDir: tmpDir, port: 3900, authToken: 'owner' })!
    const alias = `${tmpDir}-alias`
    try {
      fs.symlinkSync(tmpDir, alias, 'dir')
      fs.writeFileSync(path.join(tmpDir, 'runtime/storage-daemon.lock'), '{')
      expect(acquireStorageDaemonLock({ dataDir: alias, port: 3901, authToken: 'other' })).toBeNull()
      owner.publishPort(3902)
      expect(readStorageDaemonMeta(alias)?.port).toBe(3902)
    } finally {
      owner.release()
      fs.unlinkSync(alias)
    }
  })
})
