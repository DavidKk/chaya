import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import type { CacheTestScope } from '@/lib/translate/cache-diagnostics'
import { parseCacheLang } from '@/lib/translate/cache-lang'
import { validStructureAnnotation } from '@/lib/translate/structured-segments'
import { requireDisk } from '@/services/disk-ops'
import { CacheTestInputError, testTranslationCache } from '@/services/translate/cache-diagnostics'
import { CacheIndexNotReadyError } from '@/services/translate/shared-cache/read-only'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = defineApiRoute('post:/api/translate-cache/test', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = await request.json().catch(() => null)
  const from = parseCacheLang(body?.from),
    to = parseCacheLang(body?.to)
  if (
    typeof body?.text !== 'string' ||
    !from ||
    !to ||
    !['shared', 'game', 'combined'].includes(body.scope) ||
    (body.gameId != null && typeof body.gameId !== 'string') ||
    (body.structure != null && !validStructureAnnotation(body.structure))
  )
    return apiBadRequest('Invalid test parameters', 'CACHE_TEST_INVALID')
  try {
    return apiOk(testTranslationCache({ text: body.text, from, to, scope: body.scope as CacheTestScope, gameId: body.gameId, structure: body.structure }))
  } catch (error) {
    if (error instanceof CacheTestInputError) return apiBadRequest(error.message, error.code)
    if (error instanceof CacheIndexNotReadyError) return apiError(409, 'CACHE_INDEX_NOT_READY', error.message)
    throw error
  }
})
