import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { defaultSharedDbPath } from './db'
import { createMatchIndex } from './match-index'

export class CacheIndexNotReadyError extends Error {
  constructor() {
    super('Cache index upgrade required; open the translation library to initialize it before retrying.')
  }
}

/** Never call ensureSchema, scrub, backfill or any counting accessor on this connection. */
export function withReadOnlyCache<T>(run: (cache: { index: ReturnType<typeof createMatchIndex>; path: string } | null) => T, file = defaultSharedDbPath()): T {
  if (!fs.existsSync(file)) return run(null)
  const client = new DatabaseSync(file, { readOnly: true })
  try {
    client.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; BEGIN')
    const meta = client.prepare("SELECT value FROM cache_meta WHERE key='sentence_index_v10_exact_keys'").get() as { value: string } | undefined
    const candidates = client.prepare("SELECT value FROM cache_meta WHERE key='translation_candidates_v1'").get()
    if (!meta || !candidates) throw new CacheIndexNotReadyError()
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
