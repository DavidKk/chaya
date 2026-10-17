import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { extractAndEnsureSeed, requireDisk } from '@/services/disk-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 从当前绑定游戏 data/ 抽取文本并写入 / 合并 *-trans.seed.json。`{ export: true }` 时附带原文→译文对象。 */
export const POST = defineApiRoute('post:/api/extract', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  let includeEntries = false
  const raw = await request.text()
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as { export?: unknown }
      includeEntries = body.export === true
    } catch {
      return apiError(400, 'EXTRACT_BODY', '请求体不是 JSON')
    }
  }

  try {
    const result = extractAndEnsureSeed({ entries: includeEntries })
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'EXTRACT_FAILED', err instanceof Error ? err.message : String(err))
  }
})
