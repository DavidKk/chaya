import type { AgentTask } from '@/lib/game-agent/runtime'
import { listAgentGames } from '@/services/runtime/agent-bridge'

import { getExtTask, listExtTasks } from './ext-task.server'

export async function listAgentActivityTasks(): Promise<AgentTask[]> {
  const groups = await Promise.all(listAgentGames().map((game) => listExtTasks(game.gameId).catch(() => [])))
  return groups.flat().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function readAgentActivityTask(gameId: string, taskId: string): Promise<AgentTask | null> {
  return getExtTask(gameId, taskId)
}
