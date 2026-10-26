/** Explicit inventory/list preparation uses the same coverage rules as translation jobs. */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { TRANSLATE_CACHE_DB_PATH } from '@/constants/paths'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import { createSentenceResolver, type SentenceRecord } from '@/lib/translate/sentence-plan'

import { lookupCachedTranslation } from './cache-lookup'
import { createGameTranslateLookup } from './game-lookup'
import { createMatchIndex } from './shared-cache/match-index'

export function createGameCoverage(records: SentenceRecord[], opts?: { database?: string; blocked?: (src: string) => boolean }) {
  const lookup = createGameTranslateLookup(records)
  const resolver = createSentenceResolver(records)
  const numeric = createNumericLabelIndex(records)
  let client: DatabaseSync | undefined
  let shared: ReturnType<typeof createMatchIndex> | undefined
  let opened = false
  const resolved = new Map<string, string | null>()
  return {
    resolve(src: string): string | null {
      if (resolved.has(src)) return resolved.get(src)!
      if (opts?.blocked?.(src)) return null
      let hit: string | null = lookup[src] ?? numeric.resolve(src)
      if (hit == null) {
        if (!opened) {
          opened = true
          const database = opts?.database ?? TRANSLATE_CACHE_DB_PATH
          if (database && fs.existsSync(database)) {
            client = new DatabaseSync(database, { readOnly: true })
            client.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=250')
            if (client.prepare("SELECT 1 FROM sqlite_master WHERE name='match_keys'").get()) shared = createMatchIndex(client)
          }
        }
        const pair = { from: detectCacheLang(src), to: 'zh' as const }
        const plan = shared ? shared.plan(src, pair, resolver.select(src)) : resolver.plan(src)
        if (!plan.limited) {
          hit = plan.status === 'full' ? plan.zh : null
          // Durable control/template mirrors must still count after a job resumes.
          if (hit == null) hit = lookupCachedTranslation((key) => lookup[key], src)
          if (hit == null && shared && numericLabelFamily(src)) {
            const rows = shared.numericRecords(pair, src)
            if (!rows.limited) hit = createNumericLabelIndex([...rows, ...records]).resolve(src)
          }
          if (hit == null && /\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(src)) {
            hit = lookupCachedTranslation((key) => lookup[key] ?? shared?.record(key, pair)?.zh, src)
          }
        }
      }
      resolved.set(src, hit ?? null)
      return hit ?? null
    },
    close() {
      client?.close()
    },
  }
}
