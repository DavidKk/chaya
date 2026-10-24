import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type CutoverStatus = 'completed' | 'cleaned_temp' | 'recovered_from_archive' | 'already_clean'
type CutoverJournal = { version: 1; phase: 'prepared' | 'complete'; targetHash: string; backup: string | null }

function syncFile(file: string) {
  const fd = fs.openSync(file, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
function syncDirectory(dir: string) {
  // Windows does not expose directory fsync through Node's filesystem API.
  if (process.platform === 'win32') return
  syncFile(dir)
}
function hashFile(file: string) {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    let count: number
    while ((count = fs.readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally {
    fs.closeSync(fd)
  }
}
function checkDatabase(file: string, checkpoint: boolean) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error(`Missing or empty database: ${file}`)
  const client = new DatabaseSync(file, { readOnly: !checkpoint })
  try {
    client.exec('PRAGMA busy_timeout = 0')
    if (checkpoint) {
      const row = client.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }
      if (row.busy !== 0) throw new Error('Database checkpoint is busy; close all readers and writers before cutover')
    }
    const rows = client.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error(`Database integrity check failed: ${file}`)
    if (client.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Database foreign key check failed: ${file}`)
  } finally {
    client.close()
  }
  if (checkpoint && [file + '-wal', file + '-shm'].some((name) => fs.existsSync(name))) throw new Error('Database has other open connections; cutover refused')
}
function writeJournal(file: string, journal: CutoverJournal) {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(journal), { flag: 'wx', mode: 0o600 })
    syncFile(temp)
    fs.renameSync(temp, file)
    syncDirectory(path.dirname(file))
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

/** Caller must hold the daemon guard and close every application DB connection. */
export function atomicCutoverDatabase(options: { dbPath: string; migratedDbPath: string }): void {
  const dbPath = path.resolve(options.dbPath)
  const migrated = path.resolve(options.migratedDbPath)
  if (migrated !== `${dbPath}.migrating`) throw new Error('Cutover requires a sibling .migrating database')
  const journalPath = `${dbPath}.cutover.json`
  const archive = `${dbPath}.archive`
  if (fs.existsSync(journalPath) || fs.existsSync(archive)) throw new Error('Previous cutover artifacts require recovery or explicit archival first')
  checkDatabase(migrated, true)
  syncFile(migrated)
  let backup: string | null = null
  if (fs.existsSync(dbPath)) {
    checkDatabase(dbPath, true)
    backup = `${dbPath}.bak-${randomUUID()}`
    const old = new DatabaseSync(dbPath)
    try {
      old.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`)
    } finally {
      old.close()
    }
    syncFile(backup)
  }
  const journal: CutoverJournal = { version: 1, phase: 'prepared', targetHash: hashFile(migrated), backup }
  writeJournal(journalPath, journal)
  if (fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, archive)
    syncDirectory(path.dirname(dbPath))
  }
  fs.renameSync(migrated, dbPath)
  syncDirectory(path.dirname(dbPath))
  checkDatabase(dbPath, false)
  writeJournal(journalPath, { ...journal, phase: 'complete' })
  // Keep the verified backup and old database for explicit recovery, never auto-delete them.
}

/** Recover only a cutover with a durable journal; filenames alone do not prove validity. */
export function recoverDatabaseCutoverState(dbPath: string): CutoverStatus {
  dbPath = path.resolve(dbPath)
  const journalPath = `${dbPath}.cutover.json`
  const migrated = `${dbPath}.migrating`
  const archive = `${dbPath}.archive`
  if (!fs.existsSync(journalPath)) {
    if (fs.existsSync(migrated) || fs.existsSync(archive)) throw new Error('Unverified cutover artifacts; preserve them for recovery')
    return 'already_clean'
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as CutoverJournal
  if (journal.version !== 1 || !['prepared', 'complete'].includes(journal.phase) || !/^[a-f0-9]{64}$/.test(journal.targetHash)) throw new Error('Invalid cutover journal')
  if (fs.existsSync(dbPath)) {
    checkDatabase(dbPath, false)
    if (journal.phase === 'complete') return 'completed'
    if (hashFile(dbPath) === journal.targetHash) {
      writeJournal(journalPath, { ...journal, phase: 'complete' })
      return 'completed'
    }
    // Crash before the first rename: preserve the old valid DB and the staged DB.
    if (!fs.existsSync(archive)) return 'already_clean'
    throw new Error('Active database does not match the verified cutover; refusing automatic recovery')
  }
  if (journal.phase === 'prepared' && fs.existsSync(migrated)) {
    checkDatabase(migrated, true)
    if (hashFile(migrated) !== journal.targetHash) throw new Error('Staged database checksum mismatch')
    if ([`${dbPath}-wal`, `${dbPath}-shm`].some((file) => fs.existsSync(file))) throw new Error('Orphan SQLite sidecars require recovery before promotion')
    fs.renameSync(migrated, dbPath)
    syncDirectory(path.dirname(dbPath))
    writeJournal(journalPath, { ...journal, phase: 'complete' })
    return 'completed'
  }
  if (journal.phase === 'prepared' && fs.existsSync(archive)) {
    checkDatabase(archive, true)
    fs.renameSync(archive, dbPath)
    syncDirectory(path.dirname(dbPath))
    return 'recovered_from_archive'
  }
  throw new Error('Cutover database is missing; preserve backups and request explicit restoration')
}
