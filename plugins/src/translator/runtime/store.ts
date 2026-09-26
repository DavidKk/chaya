import { type GameContentKind, gameContentRelPath, LEGACY_FLAT_FILES } from '@/lib/game/content-paths'
import { lookupCachedTranslation } from '@/services/translate/cache-lookup'
import { isNsfwCacheRow } from '@/services/translate/sensitive-text'
import { isStorableTranslation } from '@/services/translate/text-classify'

import type { NodeFsPath } from '../../helpers/node/node-require'

export type TranslationRow = { src: string; zh: string; engine: string; updatedAt: number; hitCount: number }

/** 本作持久翻译库。所有写入串行；删除使用日志标记，避免覆盖服务刚追加的译文。 */
export function createTranslationStore(contentRoot: string, mods: NodeFsPath, onChange: () => void) {
  const { fs, path } = mods
  const rows = new Map<string, TranslationRow>()
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
        seed = nextSeed
        loadedBytes = 0
        for (const [src, zh] of Object.entries(seed)) {
          if (typeof zh === 'string' && isStorableTranslation(src, zh)) rows.set(src, { src, zh, engine: 'seed', updatedAt: 0, hitCount: 0 })
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
              const item = JSON.parse(lines[index])
              const src = Array.isArray(item) ? item[0] : item.s
              const zh = Array.isArray(item) ? item[1] : item.t
              if (typeof src !== 'string') continue
              if (zh === null) {
                rows.delete(src)
                continue
              }
              if (typeof zh === 'string' && isStorableTranslation(src, zh))
                rows.set(src, { src, zh, engine: item.engine || 'import', updatedAt: Number(item.at) || 0, hitCount: rows.get(src)?.hitCount || 0 })
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
    })
  }
  function lookup(src: string, trackHit = false): string | null {
    return lookupCachedTranslation((key) => {
      const row = rows.get(key)
      if (row && trackHit) row.hitCount++
      return row?.zh
    }, src)
  }
  async function put(pairs: Array<[string, string | null]>, engine = 'manual') {
    const valid = pairs.filter(([src, zh]) => zh === null || isStorableTranslation(src, zh))
    if (!valid.length) return
    await serial(async () => {
      await fs.promises.mkdir(path.dirname(libraryFile), { recursive: true })
      const at = Date.now()
      // 前置换行隔开旧库未换行的末行；空行由读取器忽略。
      const text = '\n' + valid.map(([s, t]) => JSON.stringify({ s, t, engine, at })).join('\n') + '\n'
      await fs.promises.appendFile(libraryFile, text, 'utf8')
      for (const [src, zh] of valid) {
        if (zh === null) rows.delete(src)
        else rows.set(src, { src, zh, engine, updatedAt: at, hitCount: 0 })
      }
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
  return { load, lookup, put, query, readJson, writeJson, fileFor, seed: () => seed, rows }
}
export type TranslationStore = ReturnType<typeof createTranslationStore>
