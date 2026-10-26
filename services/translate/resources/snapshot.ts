import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { createResourceMatcher } from '@/lib/translate/resource-matcher'
import { readResourceRevision, readResourceSnapshot } from '@/services/storage/translation-resource-store'

import { bundledResourceSnapshot } from './defaults'

const matchers = new Map<string, { identity: string; revision: number; matcher: ReturnType<typeof createResourceMatcher> }>()
/** One read transaction per batch, with no per-line IPC or shared WAL timestamp dependency. */
export function loadResourceMatcher(file = TRANSLATE_CACHE_DB_PATH) {
  if (!fs.existsSync(file)) return createResourceMatcher(bundledResourceSnapshot())
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN')
    const ready = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='translation_resource_state'").get()
    if (!ready || !db.prepare('SELECT 1 FROM translation_resource_state WHERE id=1').get()) return createResourceMatcher(bundledResourceSnapshot())
    const revision = readResourceRevision(db)
    const stat = fs.statSync(file)
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
    const previous = matchers.get(file)
    if (previous?.identity === identity && previous.revision === revision) return previous.matcher
    const matcher = createResourceMatcher(readResourceSnapshot(db))
    if (matchers.size >= 8) matchers.clear()
    matchers.set(file, { identity, revision, matcher })
    return matcher
  } finally {
    db.exec('ROLLBACK')
    db.close()
  }
}
