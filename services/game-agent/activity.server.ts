import type { SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentTraceExport, AgentTraceSummary } from '@/lib/game-agent/trace'
import { storageCall } from '@/services/storage/client'

export async function appendAgentActivity(task: AgentTask, event: AgentTaskEvent): Promise<void> {
  storageCall('trace.append', [task, event])
}

export async function appendGameActivitySource(event: SourceGameEvent): Promise<void> {
  storageCall('trace.source', [event])
}

export async function listAgentActivityTasks(gameId?: string, runtimeInstanceId?: string): Promise<AgentTraceSummary[]> {
  const tasks = storageCall<AgentTraceSummary[]>('trace.list', [gameId, runtimeInstanceId])
  return tasks.filter((task) => (!gameId || task.gameId === gameId) && (!runtimeInstanceId || task.runtimeInstanceId === runtimeInstanceId))
}

export async function readAgentActivityTask(gameId: string | undefined, taskId: string, runtimeInstanceId?: string): Promise<AgentTask | null> {
  const task = storageCall<AgentTask | null>('trace.read', [gameId, taskId, runtimeInstanceId])
  return task && (!gameId || task.gameId === gameId) && (!runtimeInstanceId || task.runtimeInstanceId === runtimeInstanceId) ? task : null
}

export async function exportAgentActivityTask(gameId: string | undefined, taskId: string, runtimeInstanceId?: string): Promise<AgentTraceExport | null> {
  const task = await readAgentActivityTask(gameId, taskId, runtimeInstanceId)
  return task ? storageCall<AgentTraceExport | null>('trace.export', [gameId, taskId, runtimeInstanceId]) : null
}

export async function removeAgentActivity(gameId?: string, taskId?: string, runtimeInstanceId?: string): Promise<number> {
  return storageCall<number>('trace.remove', [gameId, taskId, runtimeInstanceId])
}
