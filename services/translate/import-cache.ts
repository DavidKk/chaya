#!/usr/bin/env node
/**
 * 把某作内容根的 chaya-trans.cache.ndjson 导入全局 SQLite（已有不覆盖）
 *   pnpm translate:import-cache -- --root /path/to/www
 */
import fs from 'node:fs'
import path from 'node:path'

import { gameContentReadPath } from '../../lib/game/content-files'
import { createPaths } from './paths'
import { openSharedCache } from './shared-cache'
import { isStorableTranslation } from './text-classify'

function resolveContentRoot(argv = process.argv.slice(2)) {
  const eq = argv.find((a) => a.startsWith('--root='))
  if (eq) return path.resolve(eq.slice('--root='.length))
  const i = argv.indexOf('--root')
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1])
  if (process.env.CHAYA_CONTENT_ROOT) return path.resolve(process.env.CHAYA_CONTENT_ROOT)
  return process.cwd()
}

function loadNdjson(file: string) {
  const out: Record<string, string> = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const row = JSON.parse(line)
      if (Array.isArray(row) && row.length >= 2 && row[0] != null && row[1] != null) {
        out[String(row[0])] = String(row[1])
      } else if (row && row.s != null && row.t != null) {
        out[String(row.s)] = String(row.t)
      }
    } catch {
      /* skip */
    }
  }
  return out
}

const root = resolveContentRoot()
const P = createPaths(root)
const shared = openSharedCache(P.SHARED_CACHE_DB)
const ndjsonPath = gameContentReadPath(root, 'cacheNdjson', { alsoParent: true })
const map = ndjsonPath ? loadNdjson(ndjsonPath) : {}

const before = shared.stats().entries
const { inserted, total } = shared.importIgnoreExisting(map, `import:${path.basename(root)}`)
const after = shared.stats()

/** 旧名缓存同步一份到当前品牌文件名，方便后续管线与状态统计 */
if (ndjsonPath) {
  const canonical = P.CACHE_NDJSON
  if (path.resolve(ndjsonPath) !== path.resolve(canonical) && !fs.existsSync(canonical)) {
    fs.writeFileSync(
      canonical,
      Object.entries(map)
        .filter(([src, zh]) => isStorableTranslation(src, zh))
        .map((pair) => JSON.stringify(pair))
        .join('\n') + '\n'
    )
    console.log(`[import-cache] synced → ${canonical}`)
  }
}

console.log(`[import-cache] contentRoot=${root}`)
console.log(`[import-cache] file=${ndjsonPath ?? '(none)'} before=${before} inserted=${inserted} total=${total} after=${after.entries}`)
console.log(`[import-cache] 扫描 ${total} 条，新写入共享库 ${inserted}（库内现 ${after.entries}，此前 ${before}）`)
console.log(`[import-cache] db=${after.file}`)
shared.close()
