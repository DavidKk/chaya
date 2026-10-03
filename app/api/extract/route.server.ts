import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { extractAndEnsureSeed, requireDisk } from '@/services/disk-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 从当前绑定游戏 data/ 抽取文本并写入 / 合并 *-trans.seed.json */
export const POST = defineApiRoute('post:/api/extract', async () => {
  const denied = requireDisk()
  if (denied) return denied

  try {
    const result = extractAndEnsureSeed()
    return apiOk(result)
  } catch (err) {
    return apiError(500, 'EXTRACT_FAILED', err instanceof Error ? err.message : String(err))
  }
})
