import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { defaultSharedDbPath } from './db'
import { createMatchIndex } from './match-index'

export class CacheIndexNotReadyError extends Error {
  constructor() {
    super('缓存索引尚未升级，请先打开翻译库完成初始化，再重试测试。')
  }
}

/** Never call ensureSchema, scrub, backfill or any counting accessor on this connection. */
export function withReadOnlyCache<T>(run: (cache: { index: ReturnType<typeof createMatchIndex>; path: string } | null) => T, file = defaultSharedDbPath()): T {
  if (!fs.existsSync(file)) return run(null)
  const client = new DatabaseSync(file, { readOnly: true })
  try {
    client.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; BEGIN')
    const meta = client.prepare("SELECT value FROM cache_meta WHERE key='sentence_index_v9_open_parenthetical_alias'").get() as { value: string } | undefined
    if (!meta) throw new CacheIndexNotReadyError()
    const value = run({ index: createMatchIndex(client), path: file })
    client.exec('COMMIT')
    return value
  } catch (error) {
    client.exec('ROLLBACK')
    if ((error as Error).message.includes('no such table')) throw new CacheIndexNotReadyError()
    throw error
  } finally {
    client.close()
  }
}
