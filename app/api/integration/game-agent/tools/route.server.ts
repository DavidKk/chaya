import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { normalizeToolSettings } from '@/lib/game-agent/tool-settings'
import { canUseDisk } from '@/lib/service-mode/mode'
import { loadToolSettings, saveToolSettings } from '@/services/game-agent/tool-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute('get:/api/integration/game-agent/tools', async () => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', '工具配置仅在 Chaya App 或本机服务中可用')
  return apiOk({ settings: loadToolSettings() })
})

export const PUT = defineApiRoute('put:/api/integration/game-agent/tools', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', '工具配置仅在 Chaya App 或本机服务中可用')
  const body = (await request.json().catch(() => null)) as { settings?: unknown; patch?: unknown } | null
  // patch：只带改动的字段，在服务端与当前值同步合并，两个窗口同时改不同字段时互不覆盖
  if (body?.patch && typeof body.patch === 'object') return apiOk({ settings: saveToolSettings(normalizeToolSettings({ ...loadToolSettings(), ...body.patch })) })
  if (!body?.settings || typeof body.settings !== 'object') return apiError(400, 'INVALID_TOOL_SETTINGS', '缺少工具配置')
  return apiOk({ settings: saveToolSettings(normalizeToolSettings(body.settings)) })
})
