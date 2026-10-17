import { type GameContentKind, gameContentRelPath, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'
import { cacheEngineRank } from '@/lib/translate/cache-engine-rank'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'
import { applyCacheRow, type CacheOrigin, type CacheRow, parseCacheRow } from '@/lib/translate/cache-row'
import { type AlignmentGroup, createSentenceResolver, type SentenceRecord } from '@/lib/translate/sentence-plan'
import { wholeSentenceKey } from '@/lib/translate/sentence-units'
import { lookupCachedTranslation } from '@/services/translate/cache-lookup'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'
import { isReusableTranslation } from '@/services/translate/text-classify'

import type { NodeFsPath } from '../../helpers/node/node-require'

export type TranslationRow = { src: string; zh: string; engine: string; updatedAt: number; hitCount: number }

/** 本作持久翻译库。所有写入串行；删除使用日志标记，避免覆盖服务刚追加的译文。 */
export function createTranslationStore(contentRoot: string, mods: NodeFsPath, onChange: () => void = () => {}) {
  const { fs, path } = mods
  const rows = new Map<string, TranslationRow>()
  const sourceRows = new Map<string, CacheRow>()
  let cachedRecords: SentenceRecord[] | null = null
  let resolver: ReturnType<typeof createSentenceResolver> | null = null
  let seed: Record<string, string> = Object.create(null)
  let seedStamp = ''
  let libraryStamp = ''
  let loadedBytes = 0
  let writes = Promise.resolve()
  const fileFor = (kind: GameContentKind) => path.join(contentRoot, gameContentRelPath(kind))
  const readPath = (kind: GameContentKind) =>
    [fileFor(kind), ...LEGACY_FLAT_FILES[kind].map((name) => path.join(contentRoot, name))].find((file) => fs.existsSync(file)) || fileFor(kind)
  const libraryFile = readPath('cacheNdjson')

  async function readJson<T>(kind: GameContentKind, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.promises.readFile(readPath(kind), 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw error
    }
  }
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = writes.then(run)
    writes = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  async function writeJson(kind: GameContentKind, value: unknown) {
    return serial(async () => {
      const file = fileFor(kind)
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await fs.promises.writeFile(tmp, JSON.stringify(value) + '\n', 'utf8')
      await fs.promises.rename(tmp, file)
      if (kind === 'seed') seedStamp = ''
    })
  }
  async function stamp(file: string) {
    try {
      const value = await fs.promises.stat(file)
      return { key: `${file}:${value.mtimeMs}:${value.size}`, size: value.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { key: `${file}:missing`, size: 0 }
      throw error
    }
  }
  async function load() {
    return serial(async () => {
      const [seedInfo, libraryInfo] = await Promise.all([stamp(readPath('seed')), stamp(libraryFile)])
      if (seedStamp === seedInfo.key && libraryStamp === libraryInfo.key) return
      const full = seedStamp !== seedInfo.key || libraryInfo.size < loadedBytes || (libraryInfo.size === loadedBytes && libraryStamp !== libraryInfo.key)
      if (full) {
        const nextSeed = await readJson<Record<string, string>>('seed', Object.create(null))
        if (!nextSeed || typeof nextSeed !== 'object' || Array.isArray(nextSeed)) throw new Error('本作原文表格式不正确')
        rows.clear()
        sourceRows.clear()
        seed = nextSeed
        loadedBytes = 0
        for (const [src, zh] of Object.entries(seed)) {
          if (typeof zh === 'string' && isReusableTranslation(src, zh)) applyCacheRow(sourceRows, { s: src, t: zh, engine: 'seed' })
        }
      }
      if (libraryInfo.size > loadedBytes) {
        const file = await fs.promises.open(libraryFile, 'r')
        try {
          const buffer = Buffer.alloc(libraryInfo.size - loadedBytes)
          const { bytesRead } = await file.read(buffer, 0, buffer.length, loadedBytes)
          const lastNewline = buffer.lastIndexOf(10, bytesRead - 1)
          // 兼容末行没有换行的旧库；尾行不推进游标，半行下次连同剩余 UTF-8 字节重读。
          const consumed = lastNewline >= 0 ? lastNewline + 1 : 0
          const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
          for (let index = 0; index < lines.length; index++) {
            if (index && index % 1000 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
            if (!lines[index].trim()) continue
            try {
              const item = parseCacheRow(JSON.parse(lines[index]))
              if (item && (item.t === null || isReusableTranslation(item.s, item.t))) applyCacheRow(sourceRows, item)
            } catch {
              /* 历史坏行不影响其它译文 */
            }
          }
          loadedBytes += consumed
        } finally {
          await file.close()
        }
      }
      seedStamp = seedInfo.key
      libraryStamp = libraryInfo.key
      syncRows()
    })
  }
  function syncRows() {
    cachedRecords = null
    resolver = null
    const previous = new Map(rows)
    rows.clear()
    for (const row of sourceRows.values()) {
      if (row.t !== null) rows.set(row.s, { src: row.s, zh: row.t, engine: row.engine || 'import', updatedAt: row.at || 0, hitCount: previous.get(row.s)?.hitCount || 0 })
    }
  }
  function records(): SentenceRecord[] {
    return (cachedRecords ??= [...sourceRows.values()]
      .filter((r) => r.t !== null)
      .map((r) => ({
        id: r.origin?.id || `local:${r.s}`,
        revision: r.origin?.revision || 0,
        src: r.s,
        zh: r.t!,
        engine: r.engine || 'legacy-local',
        local: !r.origin,
        alignments: r.alignments,
        newlines: r.newlines,
      })))
  }
  const plan = (src: string) => (resolver ??= createSentenceResolver(records())).plan(src)
  function lookup(src: string, trackHit = false): string | null {
    const planned = plan(src)
    if (planned.status === 'full') {
      if (trackHit)
        for (const match of planned.matches) {
          const row = rows.get(match.record.src)
          if (row) row.hitCount++
        }
      return planned.zh
    }
    return lookupCachedTranslation((key) => {
      const row = rows.get(key)
      if (row && trackHit) row.hitCount++
      return row?.zh ?? (plan(key).status === 'full' ? plan(key).zh : null)
    }, src)
  }
  async function put(pairs: Array<[string, string | null]>, engine = 'manual', alignments?: Array<{ src: string; groups: AlignmentGroup[] }>) {
    await load()
    return serial(async () => {
      await fs.promises.mkdir(path.dirname(libraryFile), { recursive: true })
      const at = Date.now()
      const accepted: Array<[string, string | null]> = []
      const events: CacheRow[] = []
      const byKey = new Map<string, SentenceRecord[]>()
      for (const record of records()) {
        const key = wholeSentenceKey(record.src)
        byKey.set(key, [...(byKey.get(key) || []), record])
      }
      for (const [src, zh] of pairs) {
        if (zh !== null) {
          if (!isReusableTranslation(src, zh)) continue
          const group = byKey.get(wholeSentenceKey(src)) || []
          if (group.some((r) => cacheEngineRank(r.engine) > cacheEngineRank(engine))) continue
          if (group.some((r) => r.src !== src && cacheEngineRank(r.engine) === cacheEngineRank(engine) && r.zh !== zh) && !(engine === 'manual' && sourceRows.has(src))) continue
        }
        const row = parseCacheRow({ s: src, t: zh, engine, at, alignments: alignments?.find((a) => a.src === src)?.groups })!
        events.push(row)
        accepted.push([src, zh])
        const key = wholeSentenceKey(src)
        const next = (byKey.get(key) || []).filter((r) => r.src !== src)
        if (zh !== null) next.push({ id: `local:${src}`, revision: 0, src, zh, engine, local: true })
        byKey.set(key, next)
      }
      if (events.length) {
        const release = lockCacheFile(fs, libraryFile)
        try {
          appendCacheLines(fs, libraryFile, events)
        } finally {
          release()
        }
        for (const event of events) applyCacheRow(sourceRows, event)
        syncRows()
        onChange()
      }
      return accepted
    })
  }
  function references(texts: string[]): CacheOrigin[] {
    const used = new Set(texts.flatMap((src) => plan(src).matches.map((m) => m.record.src)))
    return [...sourceRows.values()].filter((r) => used.has(r.s) && r.origin).map((r) => r.origin!)
  }
  async function invalidateOrigins(origins: CacheOrigin[]) {
    await load()
    await serial(async () => {
      const events: CacheRow[] = []
      for (const row of sourceRows.values())
        if (row.origin && origins.some((o) => o.database === row.origin!.database && o.id === row.origin!.id && o.revision === row.origin!.revision))
          events.push({ s: row.s, t: null, origin: row.origin })
      if (!events.length) return
      const release = lockCacheFile(fs, libraryFile)
      try {
        appendCacheLines(fs, libraryFile, events)
      } finally {
        release()
      }
      for (const event of events) applyCacheRow(sourceRows, event)
      syncRows()
      onChange()
    })
  }
  async function query(params: URLSearchParams) {
    await load()
    const q = params.get('q') || ''
    const engine = params.get('engine') || ''
    const nsfw = params.get('nsfw') === '1'
    const all = [...rows.values()]
    const filtered = all.filter((r) => (!q || r.src.includes(q) || r.zh.includes(q)) && (!engine || engine === r.engine) && (!nsfw || isNsfwCacheRow(r.src, r.engine)))
    const field = params.get('sort') === 'hits' ? 'hitCount' : 'updatedAt'
    filtered.sort((a, b) => (a[field] - b[field]) * (params.get('order') === 'asc' ? 1 : -1) || a.src.localeCompare(b.src))
    const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 20))
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const page = Math.min(totalPages, Math.max(1, Number(params.get('page')) || 1))
    return {
      page,
      pageSize,
      totalPages,
      total: filtered.length,
      q,
      engine,
      engines: [...new Set(all.map((row) => row.engine))],
      items: filtered.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, nsfw: isNsfwCacheRow(r.src, r.engine) })),
      file: libraryFile,
    }
  }
  return { load, lookup, put, query, readJson, writeJson, fileFor, seed: () => seed, rows, records, plan, references, invalidateOrigins }
}
export type TranslationStore = ReturnType<typeof createTranslationStore>
