jest.mock('wordguard', () => ({
  wordguard: () => ({
    matchAll: () => [],
  }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { atomicCutoverDatabase, recoverDatabaseCutoverState } from '@/services/storage/migration/atomic-cutover'
import { migrateGameTranslations } from '@/services/storage/migration/translation-migrator'
import { commitTranslations, getBoundedSnapshot, lookupTranslation } from '@/services/storage/translation-store'
import { openSharedCacheDb } from '@/services/translate/shared-cache/db'

describe('storage-pipeline & tombstone semantics', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-storage-pipeline-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('enforces Tombstone blocking: is_deleted = 1 strictly prevents shared fallback', () => {
    const dbPath = path.join(tmpDir, 'shared.sqlite')
    const { db } = openSharedCacheDb(dbPath)

    try {
      // 1. Populate shared translation
      db.$client.exec(`
        INSERT INTO translations (src, src_lang, tgt_lang, zh, engine, updated_at)
        VALUES ('こんにちは', 'ja', 'zh', '你好（共享）', 'google', 1000)
      `)

      // Lookup without game translation falls back to shared
      const beforeTombstone = lookupTranslation(db, 'game-1', 'こんにちは')
      expect(beforeTombstone.scope).toBe('shared')
      expect(beforeTombstone.zh).toBe('你好（共享）')
      expect(beforeTombstone.isDeleted).toBe(false)

      // 2. Commit game-specific translation
      commitTranslations(db, {
        gameId: 'game-1',
        actor: 'user',
        entries: [{ src: 'こんにちは', zh: '你好（本作）', engine: 'manual' }],
      })

      const afterGameTrans = lookupTranslation(db, 'game-1', 'こんにちは')
      expect(afterGameTrans.scope).toBe('game')
      expect(afterGameTrans.zh).toBe('你好（本作）')
      expect(afterGameTrans.isDeleted).toBe(false)

      // 3. Delete translation in game-1 (Tombstone)
      commitTranslations(db, {
        gameId: 'game-1',
        actor: 'user',
        entries: [{ src: 'こんにちは', isDeleted: true }],
      })

      // Query MUST be blocked from falling back to shared pool
      const afterTombstone = lookupTranslation(db, 'game-1', 'こんにちは')
      expect(afterTombstone.scope).toBe('game')
      expect(afterTombstone.zh).toBeNull()
      expect(afterTombstone.isDeleted).toBe(true)

      // Another game (game-2) still sees the shared translation
      const game2Lookup = lookupTranslation(db, 'game-2', 'こんにちは')
      expect(game2Lookup.scope).toBe('shared')
      expect(game2Lookup.zh).toBe('你好（共享）')

      // 4. Resurrect Tombstone with new manual translation
      commitTranslations(db, {
        gameId: 'game-1',
        actor: 'user',
        entries: [{ src: 'こんにちは', zh: '你好（复活）', engine: 'manual', isDeleted: false }],
      })

      const afterResurrect = lookupTranslation(db, 'game-1', 'こんにちは')
      expect(afterResurrect.scope).toBe('game')
      expect(afterResurrect.zh).toBe('你好（复活）')
      expect(afterResurrect.isDeleted).toBe(false)
    } finally {
      db.$client.close()
    }
  })

  it('guarantees idempotency on commitTranslations', () => {
    const dbPath = path.join(tmpDir, 'shared.sqlite')
    const { db } = openSharedCacheDb(dbPath)

    try {
      const commitInput = {
        gameId: 'game-idem',
        actor: 'test',
        idempotencyKey: 'idemp-key-001',
        entries: [{ src: 'テスト', zh: '测试', engine: 'manual' }],
      }

      const res1 = commitTranslations(db, commitInput)
      expect(res1.ok).toBe(true)
      expect(res1.duplicated).toBe(false)
      expect(res1.appliedCount).toBe(1)

      // Replay identical idempotencyKey
      const res2 = commitTranslations(db, commitInput)
      expect(res2.ok).toBe(true)
      expect(res2.duplicated).toBe(true)
      expect(res2.appliedCount).toBe(0)
    } finally {
      db.$client.close()
    }
  })

  it('migrates game seed.json and cache.ndjson lazily into game_translations', async () => {
    const dbPath = path.join(tmpDir, 'shared.sqlite')
    const { db } = openSharedCacheDb(dbPath)

    const gameRoot = path.join(tmpDir, 'MyGame')
    const transDir = path.join(gameRoot, 'chaya', 'translate')
    fs.mkdirSync(transDir, { recursive: true })

    fs.writeFileSync(
      path.join(transDir, 'seed.json'),
      JSON.stringify({
        開始: '开始',
        設定: { zh: '设置', category: 'menu' },
      })
    )

    fs.writeFileSync(
      path.join(transDir, 'cache.ndjson'),
      JSON.stringify({ s: 'アイテム', t: '道具', engine: 'cache', at: 1234 }) + '\n' + JSON.stringify(['セーブ', '存档']) + '\n'
    )

    try {
      const res = await migrateGameTranslations(db, {
        gameId: 'game-mig-test',
        contentRoot: gameRoot,
      })

      expect(res.seedImported).toBe(2)
      expect(res.cacheImported).toBe(2)
      expect(res.alreadyMigrated).toBe(false)

      // Verified migrated entries
      const lookup1 = lookupTranslation(db, 'game-mig-test', '開始')
      expect(lookup1.zh).toBe('开始')
      expect(lookup1.scope).toBe('game')

      const lookup2 = lookupTranslation(db, 'game-mig-test', 'アイテム')
      expect(lookup2.zh).toBe('道具')
      expect(lookup2.scope).toBe('game')

      // Second migration call is skipped due to .migrated marker
      const res2 = await migrateGameTranslations(db, {
        gameId: 'game-mig-test',
        contentRoot: gameRoot,
      })
      expect(res2.alreadyMigrated).toBe(true)
    } finally {
      db.$client.close()
    }
  })

  it('executes atomic WAL cutover and crash self-healing recovery', () => {
    const mainDb = path.join(tmpDir, 'target.sqlite')
    const tempDb = path.join(tmpDir, 'target.sqlite.migrating')

    // Create old main db
    const client1 = new DatabaseSync(mainDb)
    client1.exec('PRAGMA journal_mode = WAL; CREATE TABLE old_t (val TEXT);')
    client1.close()

    // Create migrating db
    const client2 = new DatabaseSync(tempDb)
    client2.exec('PRAGMA journal_mode = WAL; CREATE TABLE new_t (val TEXT);')
    client2.close()

    // Cutover
    atomicCutoverDatabase({ dbPath: mainDb, migratedDbPath: tempDb })

    expect(fs.existsSync(mainDb)).toBe(true)
    expect(fs.existsSync(tempDb)).toBe(false)
    expect(fs.existsSync(`${mainDb}.archive`)).toBe(true)

    const clientFinal = new DatabaseSync(mainDb)
    const tables = clientFinal.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    clientFinal.close()
    expect(tables.some((t) => t.name === 'new_t')).toBe(true)
    expect(tables.some((t) => t.name === 'old_t')).toBe(false)

    expect(recoverDatabaseCutoverState(mainDb)).toBe('completed')
  })

  it('does not acknowledge a reused idempotency key with a changed payload or another game', () => {
    const { db } = openSharedCacheDb(path.join(tmpDir, 'shared.sqlite'))
    try {
      const input = { gameId: 'one', actor: 'user', idempotencyKey: 'same-key', entries: [{ src: '項目', zh: '项目' }] }
      commitTranslations(db, input)
      expect(() => commitTranslations(db, { ...input, gameId: 'two' })).toThrow('different request')
      expect(() => commitTranslations(db, { ...input, entries: [{ src: '項目', zh: '被覆盖' }] })).toThrow('different request')
      expect(lookupTranslation(db, 'one', '項目').zh).toBe('项目')
      expect(lookupTranslation(db, 'two', '項目').zh).toBeNull()
    } finally {
      db.$client.close()
    }
  })

  it('bounds both game and shared snapshots and returns continuation cursors', () => {
    const { db } = openSharedCacheDb(path.join(tmpDir, 'shared.sqlite'))
    try {
      commitTranslations(db, {
        gameId: 'paged',
        actor: 'user',
        entries: [
          { src: 'a', zh: 'A' },
          { src: 'b', zh: 'B' },
          { src: 'c', isDeleted: true },
        ],
      })
      const first = getBoundedSnapshot(db, 'paged', 'ja', 'zh', { pageSize: 2 })
      expect(first.gameTranslations.map((row) => row.src)).toEqual(['a', 'b'])
      expect(first.nextGameAfter).toBe('b')
      const next = getBoundedSnapshot(db, 'paged', 'ja', 'zh', { pageSize: 2, gameAfter: first.nextGameAfter! })
      expect(next.gameTranslations).toMatchObject([{ src: 'c', isDeleted: 1 }])
      expect(next.nextGameAfter).toBeNull()
    } finally {
      db.$client.close()
    }
  })

  it('aborts malformed legacy input without a success marker or partial database writes', async () => {
    const { db } = openSharedCacheDb(path.join(tmpDir, 'shared.sqlite'))
    const root = path.join(tmpDir, 'game')
    const dir = path.join(root, 'chaya/translate')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify({ 開始: '开始' }))
    fs.writeFileSync(path.join(dir, 'cache.ndjson'), '["項目","项目"]\n{broken\n')
    try {
      await expect(migrateGameTranslations(db, { gameId: 'test', contentRoot: root })).rejects.toThrow()
      expect(lookupTranslation(db, 'test', '開始').zh).toBeNull()
      expect(fs.existsSync(path.join(dir, '.migrated'))).toBe(false)
      fs.writeFileSync(path.join(dir, 'cache.ndjson'), '["項目","项目"]\n{"s":"削除","t":null}\n')
      // A disk marker from another installation must not skip an import into this DB.
      fs.writeFileSync(path.join(dir, '.migrated'), '{"gameId":"other"}')
      await migrateGameTranslations(db, { gameId: 'test', contentRoot: root })
      expect(lookupTranslation(db, 'test', '項目').zh).toBe('项目')
      expect(lookupTranslation(db, 'test', '削除').isDeleted).toBe(true)
    } finally {
      db.$client.close()
    }
  })

  it('refuses an invalid staged DB and retains the original and unverified recovery files', () => {
    const main = path.join(tmpDir, 'old.sqlite')
    const migrated = `${main}.migrating`
    const client = new DatabaseSync(main)
    client.exec("CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES ('original')")
    client.close()
    fs.writeFileSync(migrated, 'not a database')
    expect(() => atomicCutoverDatabase({ dbPath: main, migratedDbPath: migrated })).toThrow()
    expect(() => recoverDatabaseCutoverState(main)).toThrow('Unverified')
    const reader = new DatabaseSync(main)
    try {
      expect(reader.prepare('SELECT value FROM keep').get()).toMatchObject({ value: 'original' })
    } finally {
      reader.close()
    }
    expect(fs.existsSync(migrated)).toBe(true)
  })
})
