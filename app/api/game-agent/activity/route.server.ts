import { defineApiRoute } from '@/initializer/controller'
import { apiNotFound, apiOk } from '@/initializer/response'
import { listAgentActivityTasks, readAgentActivityTask } from '@/services/game-agent/activity.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineApiRoute('get:/api/game-agent/activity', async ({ request }) => {
  const search = new URL(request.url).searchParams
  const taskId = search.get('taskId')?.trim()
  const gameId = search.get('gameId')?.trim()
  if (!taskId) return apiOk({ tasks: await listAgentActivityTasks() })
  if (!gameId) return apiNotFound('缺少游戏标识', 'GAME_ID_REQUIRED')
  const task = await readAgentActivityTask(gameId, taskId)
  return task ? apiOk({ task }) : apiNotFound('Agent 任务不存在', 'AGENT_TASK_NOT_FOUND')
})
