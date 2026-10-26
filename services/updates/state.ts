import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { type UpdatePackage } from '@/lib/updates/protocol'

export type InstalledUpdate = {
  descriptor: UpdatePackage
  phase: 'downloading' | 'installing' | 'installed' | 'activating' | 'error'
  error?: string
}

/** A persistent OS lock, independent of short-lived download progress snapshots. */
export async function withUpdateState<T>(directory: string, run: (state: UpdateState) => Promise<T>): Promise<T> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const guard = new DatabaseSync(path.join(directory, 'guard.sqlite'))
  let state: UpdateState | undefined
  try {
    try {
      guard.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
    } catch {
      throw new Error('Another update operation is running; retry after it finishes')
    }
    state = new UpdateState(path.join(directory, 'state.sqlite'))
    return await run(state)
  } finally {
    state?.close()
    // Never unlink guard.sqlite: other processes must lock the same inode.
    guard.close()
  }
}

export class UpdateState {
  private db: DatabaseSync
  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS packages(
        id TEXT NOT NULL, version TEXT NOT NULL, descriptor TEXT NOT NULL,
        phase TEXT NOT NULL, error TEXT, PRIMARY KEY(id, version));
      CREATE TABLE IF NOT EXISTS events(
        sequence INTEGER PRIMARY KEY, time INTEGER NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, action TEXT NOT NULL);
    `)
  }
  list(): InstalledUpdate[] {
    return (
      this.db.prepare('SELECT descriptor, phase, error FROM packages ORDER BY id, version').all() as { descriptor: string; phase: InstalledUpdate['phase']; error: string | null }[]
    ).map((row) => ({ descriptor: JSON.parse(row.descriptor), phase: row.phase, ...(row.error ? { error: row.error } : {}) }))
  }
  save(descriptor: UpdatePackage, phase: InstalledUpdate['phase'], error?: string) {
    const existing = this.list().find((item) => item.descriptor.packageId === descriptor.packageId && item.descriptor.packageVersion === descriptor.packageVersion)
    if (existing && JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor)) throw new Error('Installed package identity is immutable')
    this.db
      .prepare(`INSERT INTO packages VALUES(?,?,?,?,?) ON CONFLICT(id,version) DO UPDATE SET phase=excluded.phase,error=excluded.error`)
      .run(descriptor.packageId, descriptor.packageVersion, JSON.stringify(descriptor), phase, error ?? null)
  }
  event(descriptor: UpdatePackage, action: string) {
    this.db.prepare('INSERT INTO events(time,id,version,action) VALUES(?,?,?,?)').run(Date.now(), descriptor.packageId, descriptor.packageVersion, action)
  }
  close() {
    this.db.close()
  }
}
