import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentTraceExport, AgentTraceSummary } from '@/lib/game-agent/trace'

import { agentTraceFileStore } from './activity-file-store.server'

export async function appendAgentActivity(task: AgentTask, event: AgentTaskEvent): Promise<void> {
  await agentTraceFileStore.append(task, event)
}

export async function appendGameActivitySource(event: SourceGameEvent): Promise<void> {
  await agentTraceFileStore.appendSource(event)
}

export async function listAgentActivityTasks(gameId?: string, runtimeInstanceId?: string): Promise<AgentTraceSummary[]> {
  const tasks = await agentTraceFileStore.list()
  return tasks.filter((task) => (!gameId || task.gameId === gameId) && (!runtimeInstanceId || task.runtimeInstanceId === runtimeInstanceId))
}

export async function readAgentActivityTask(gameId: string | undefined, taskId: string, runtimeInstanceId?: string): Promise<AgentTask | null> {
  const task = await agentTraceFileStore.read(taskId)
  return task && (!gameId || task.gameId === gameId) && (!runtimeInstanceId || task.runtimeInstanceId === runtimeInstanceId) ? task : null
}

export async function exportAgentActivityTask(gameId: string | undefined, taskId: string, runtimeInstanceId?: string): Promise<AgentTraceExport | null> {
  const task = await readAgentActivityTask(gameId, taskId, runtimeInstanceId)
  return task ? agentTraceFileStore.export(taskId) : null
}

export async function removeAgentActivity(gameId?: string, taskId?: string, runtimeInstanceId?: string): Promise<number> {
  if (runtimeInstanceId) return agentTraceFileStore.removeForRuntime(runtimeInstanceId, taskId, gameId)
  return gameId ? agentTraceFileStore.removeForGame(gameId, taskId) : agentTraceFileStore.remove(taskId)
}
