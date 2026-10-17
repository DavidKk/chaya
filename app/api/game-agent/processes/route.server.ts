import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { canUseDisk } from '@/lib/service-mode/mode'
import { killLiveAgentProcess, listLiveAgentProcesses } from '@/services/game-agent/cli/live-processes.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Living Agent CLI / SDK children Chaya spawned, plus matching processes still on the machine. */
export const GET = defineApiRoute('get:/api/game-agent/processes', async () => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 进程列表需要 Chaya App 或本机服务')
  const processes = await listLiveAgentProcesses()
  return apiOk({ processes, count: processes.length, at: Date.now() })
})

/** Kill one listed process (`id` = chaya-* or system-<pid>). */
export const DELETE = defineApiRoute('delete:/api/game-agent/processes', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'GAME_AGENT_LOCAL_ONLY', 'Agent 进程列表需要 Chaya App 或本机服务')
  const id = new URL(request.url).searchParams.get('id')?.trim() || ''
  if (!id) return apiError(400, 'PROCESS_ID_REQUIRED', '缺少进程 id')
  const result = await killLiveAgentProcess(id)
  if (!result.ok) return apiError(400, 'PROCESS_KILL_FAILED', result.error)
  return apiOk({ killed: id })
})
