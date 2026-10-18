import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { parseCacheLiveFlag, parseCacheNsfwFlag } from '@/lib/translate/cache-engine-kind'
import { parseCacheLang } from '@/lib/translate/cache-lang'
import { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'
import {
  deleteSharedTranslateCache,
  getSharedTranslateCacheById,
  importSharedTranslateCache,
  parseTranslateImportText,
  querySharedTranslateCache,
  requireDisk,
  setSharedTranslateCacheNsfw,
  updateSharedTranslateCache,
} from '@/services/disk-ops'
import { isIdenticalTranslation } from '@/services/translate/text-classify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_IMPORT_BYTES = 32 * 1024 * 1024

export const GET = defineApiRoute('get:/api/translate-cache', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const url = new URL(request.url)
  const idRaw = url.searchParams.get('id')
  if (idRaw != null && idRaw !== '') {
    const id = Math.floor(Number(idRaw) || 0)
    if (id <= 0) return apiBadRequest('Invalid cache id', 'CACHE_ID_INVALID')
    try {
      const item = getSharedTranslateCacheById(id)
      if (!item) return apiError(404, 'CACHE_NOT_FOUND', 'Cache entry not found')
      return apiOk({ item })
    } catch (err) {
      return apiError(500, 'CACHE_QUERY_FAILED', err instanceof Error ? err.message : String(err))
    }
  }

  const page = Number(url.searchParams.get('page') || '1')
  const pageSize = Number(url.searchParams.get('pageSize') || '50')
  const q = url.searchParams.get('q') || ''
  const engine = url.searchParams.get('engine') || ''
  const nsfwFlag = parseCacheNsfwFlag(url.searchParams.get('nsfw'))
  const live = parseCacheLiveFlag(url.searchParams.get('live'))
  const from = parseCacheLang(url.searchParams.get('from'))
  const to = parseCacheLang(url.searchParams.get('to'))
  const sort = url.searchParams.get('sort') || 'updated'
  const order = url.searchParams.get('order') || 'desc'

  try {
    const data = querySharedTranslateCache({
      page,
      pageSize,
      q,
      engine,
      nsfw: nsfwFlag === 'nsfw',
      nsfwFlag,
      live,
      from,
      to,
      sort: parseSharedCacheSortKey(sort),
      order: parseSharedCacheSortDir(order),
    })
    return apiOk({ ...data })
  } catch (err) {
    return apiError(500, 'CACHE_QUERY_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 导入 JSON `{原文:译文}` 或 NDJSON（`[src,zh]` / `{s,t}`）到共享翻译库 */
export const POST = defineApiRoute('post:/api/translate-cache', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const ct = request.headers.get('content-type') || ''
    let text = ''
    let overwrite = false
    let filename = ''

    if (ct.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return apiError(400, 'IMPORT_NO_FILE', 'Please select a file to import')
      }
      if (file.size > MAX_IMPORT_BYTES) {
        return apiError(400, 'IMPORT_TOO_LARGE', `File too large (limit: ${MAX_IMPORT_BYTES / 1024 / 1024}MB)`)
      }
      text = await file.text()
      filename = file.name || ''
      const ow = form.get('overwrite')
      overwrite = ow === '1' || ow === 'true'
    } else {
      const body = (await request.json().catch(() => ({}))) as { text?: string; overwrite?: boolean; filename?: string }
      text = String(body.text || '')
      overwrite = Boolean(body.overwrite)
      filename = String(body.filename || '')
      if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
        return apiError(400, 'IMPORT_TOO_LARGE', `Content too large (limit: ${MAX_IMPORT_BYTES / 1024 / 1024}MB)`)
      }
    }

    if (!text.trim()) {
      return apiError(400, 'IMPORT_EMPTY', 'File is empty')
    }

    const parsed = parseTranslateImportText(text)
    const pairCount = Object.keys(parsed.map).length
    if (pairCount === 0) {
      return apiError(400, 'IMPORT_NO_PAIRS', 'No valid translations parsed (requires JSON key-value or NDJSON)')
    }

    const result = importSharedTranslateCache(parsed.map, {
      overwrite,
      format: parsed.format,
      skippedLines: parsed.skipped,
      alignments: parsed.alignments,
      engine: filename ? `import:${filename}` : 'import',
    })

    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_IMPORT_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 修改一条缓存译文或手动 NSFW 标记（原文主键不变） */
export const PATCH = defineApiRoute('patch:/api/translate-cache', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const body = (await request.json().catch(() => ({}))) as {
      src?: string
      zh?: string
      from?: string
      to?: string
      nsfw?: boolean
    }
    const src = String(body.src ?? '')
    const zh = String(body.zh ?? '').trim()
    const nsfwProvided = typeof body.nsfw === 'boolean'
    const pair = { from: body.from, to: body.to }
    if (!src) return apiBadRequest('Missing source text', 'CACHE_SRC_REQUIRED')

    if (!zh) {
      if (!nsfwProvided) return apiBadRequest('Translation text cannot be empty', 'CACHE_ZH_REQUIRED')
      const result = setSharedTranslateCacheNsfw(src, body.nsfw as boolean, pair)
      if (!result.updated) return apiError(404, 'CACHE_NOT_FOUND', 'Cache not found for the given source text')
      return apiOk(result)
    }

    if (isIdenticalTranslation(src, zh)) {
      if (!nsfwProvided) return apiBadRequest('Source and translation are identical, skipping save', 'CACHE_IDENTICAL')
      const result = setSharedTranslateCacheNsfw(src, body.nsfw as boolean, pair)
      if (!result.updated) return apiError(404, 'CACHE_NOT_FOUND', 'Cache not found for the given source text')
      return apiOk(result)
    }

    const result = updateSharedTranslateCache(src, zh, 'manual', pair, nsfwProvided ? { nsfw: body.nsfw } : undefined)
    if (!result.updated) return apiError(404, 'CACHE_NOT_FOUND', 'Cache not found for the given source text')
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_UPDATE_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 按原文与语言对删除一条缓存 */
export const DELETE = defineApiRoute('delete:/api/translate-cache', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const body = (await request.json().catch(() => ({}))) as { src?: string; from?: string; to?: string }
    const src = String(body.src ?? '')
    if (!src) return apiBadRequest('Missing source text', 'CACHE_SRC_REQUIRED')

    const result = deleteSharedTranslateCache(src, { from: body.from, to: body.to })
    if (!result.deleted) return apiError(404, 'CACHE_NOT_FOUND', 'Cache not found for the given source text')
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_DELETE_FAILED', err instanceof Error ? err.message : String(err))
  }
})
