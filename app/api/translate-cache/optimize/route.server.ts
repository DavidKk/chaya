import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { parseCacheLang } from '@/lib/translate/cache-lang'
import type { NewlineAnnotation } from '@/lib/translate/logic-text'
import type { AlignmentGroup } from '@/lib/translate/sentence-plan'
import { requireDisk, upsertSharedTranslateCachePairs } from '@/services/disk-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseNewlines(raw: unknown): NewlineAnnotation[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((n) => ({
    start: Number((n as { start?: number }).start),
    end: Number((n as { end?: number }).end),
    kind: String((n as { kind?: string }).kind || 'unknown') as NewlineAnnotation['kind'],
  }))
}

function parseGroups(raw: unknown): AlignmentGroup[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((g) => ({
    sourceStart: Number((g as AlignmentGroup).sourceStart),
    sourceEnd: Number((g as AlignmentGroup).sourceEnd),
    targetStart: Number((g as AlignmentGroup).targetStart),
    targetEnd: Number((g as AlignmentGroup).targetEnd),
    evidence: ((g as AlignmentGroup).evidence === 'structural' ? 'structural' : 'verified') as AlignmentGroup['evidence'],
  }))
}

/**
 * Confirm optimize draft: parent mapping + optional newline annotations.
 * dryRun=true runs the same validator without writing.
 */
export const POST = defineApiRoute('post:/api/translate-cache/optimize', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const body = (await request.json().catch(() => ({}))) as {
      parent?: { src?: string; zh?: string }
      pairs?: Array<{ src?: string; zh?: string }>
      from?: string
      to?: string
      newlines?: unknown
      groups?: unknown
      expectedRevision?: number
      dryRun?: boolean
    }
    if (typeof body.parent?.src !== 'string' || typeof body.parent.zh !== 'string') return apiBadRequest('缺少原始定稿，请刷新优化页面', 'CACHE_OPTIMIZE_PARENT_REQUIRED')
    const raw = Array.isArray(body.pairs) ? body.pairs : []
    const pairs = raw.map((p) => ({ src: String(p?.src ?? '').trim(), zh: String(p?.zh ?? '').trim() })).filter((p) => p.src && p.zh)
    const newlines = parseNewlines(body.newlines)
    const groups = parseGroups(body.groups)
    if (!pairs.length && !newlines?.length && !groups?.length) return apiBadRequest('没有可写入的句段', 'CACHE_OPTIMIZE_EMPTY')

    const from = parseCacheLang(body.from) || undefined
    const to = parseCacheLang(body.to) || undefined
    const result = upsertSharedTranslateCachePairs(
      pairs,
      'manual:optimize',
      { from, to },
      { src: body.parent.src, zh: body.parent.zh },
      {
        newlines,
        groups,
        expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
        dryRun: Boolean(body.dryRun),
      }
    )
    if (result.stale) return apiError(409, 'CACHE_CHANGED', '原始定稿已更新，请重新加载')
    if (body.dryRun) return apiOk(result)
    if (!result.total && !newlines?.length) return apiError(400, 'CACHE_OPTIMIZE_NONE', '没有写入任何句段（可能被校验跳过）')
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'CACHE_OPTIMIZE_FAILED', err instanceof Error ? err.message : String(err))
  }
})
