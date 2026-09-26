import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { parseSharedCacheSortDir, parseSharedCacheSortKey } from '@/lib/translate/cache-query'
import {
  deleteSharedTranslateCache,
  importSharedTranslateCache,
  parseTranslateImportText,
  querySharedTranslateCache,
  requireDisk,
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
  const page = Number(url.searchParams.get('page') || '1')
  const pageSize = Number(url.searchParams.get('pageSize') || '50')
  const q = url.searchParams.get('q') || ''
  const engine = url.searchParams.get('engine') || ''
  const nsfwRaw = url.searchParams.get('nsfw') || ''
  const nsfw = nsfwRaw === '1' || nsfwRaw === 'true'
  const sort = url.searchParams.get('sort') || 'updated'
  const order = url.searchParams.get('order') || 'desc'

  try {
    const data = querySharedTranslateCache({
      page,
      pageSize,
      q,
      engine,
      nsfw,
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
        return apiError(400, 'IMPORT_NO_FILE', '请选择要导入的文件')
      }
      if (file.size > MAX_IMPORT_BYTES) {
        return apiError(400, 'IMPORT_TOO_LARGE', `文件过大（上限 ${MAX_IMPORT_BYTES / 1024 / 1024}MB）`)
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
        return apiError(400, 'IMPORT_TOO_LARGE', `内容过大（上限 ${MAX_IMPORT_BYTES / 1024 / 1024}MB）`)
      }
    }

    if (!text.trim()) {
      return apiError(400, 'IMPORT_EMPTY', '文件为空')
    }

    const parsed = parseTranslateImportText(text)
    const pairCount = Object.keys(parsed.map).length
    if (pairCount === 0) {
      return apiError(400, 'IMPORT_NO_PAIRS', '未解析到有效译文（需 JSON 键值或 NDJSON）')
    }

    const result = importSharedTranslateCache(parsed.map, {
      overwrite,
      format: parsed.format,
      skippedLines: parsed.skipped,
      engine: filename ? `import:${filename}` : 'import',
    })

    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_IMPORT_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 修改一条缓存译文（原文主键不变） */
export const PATCH = defineApiRoute('patch:/api/translate-cache', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const body = (await request.json().catch(() => ({}))) as { src?: string; zh?: string }
    const src = String(body.src ?? '')
    const zh = String(body.zh ?? '').trim()
    if (!src) return apiBadRequest('缺少原文', 'CACHE_SRC_REQUIRED')
    if (!zh) return apiBadRequest('译文不能为空', 'CACHE_ZH_REQUIRED')
    if (isIdenticalTranslation(src, zh)) return apiBadRequest('原文与译文相同，无需保存', 'CACHE_IDENTICAL')

    const result = updateSharedTranslateCache(src, zh, 'manual')
    if (!result.updated) return apiError(404, 'CACHE_NOT_FOUND', '未找到该原文对应的缓存')
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_UPDATE_FAILED', err instanceof Error ? err.message : String(err))
  }
})

/** 按原文删除一条缓存 */
export const DELETE = defineApiRoute('delete:/api/translate-cache', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const body = (await request.json().catch(() => ({}))) as { src?: string }
    const src = String(body.src ?? '')
    if (!src) return apiBadRequest('缺少原文', 'CACHE_SRC_REQUIRED')

    const result = deleteSharedTranslateCache(src)
    if (!result.deleted) return apiError(404, 'CACHE_NOT_FOUND', '未找到该原文对应的缓存')
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_DELETE_FAILED', err instanceof Error ? err.message : String(err))
  }
})
