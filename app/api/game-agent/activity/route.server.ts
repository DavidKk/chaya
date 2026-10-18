import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiNotFound, apiOk } from '@/initializer/response'
import { sourceEventKey, type SourceGameEvent } from '@/lib/game-agent/audit'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import { AgentTraceConflictError, GAME_LOG_EVENT_CONFLICT } from '@/lib/game-agent/trace'
import {
  appendAgentActivity,
  appendGameActivitySource,
  exportAgentActivityTask,
  listAgentActivityTasks,
  readAgentActivityTask,
  removeAgentActivity,
} from '@/services/game-agent/activity.server'
import { assertGameLogWriterLease, GAME_LOG_WRITER_LEASE_REJECTED, GameLogWriterLeaseError } from '@/services/game-agent/source-writer-lease.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validSourceEvent(source: SourceGameEvent): boolean {
  const producer = source.producer
  const runtimeTarget = source.targets?.find((target) => target.runtimeInstanceId)
  return Boolean(
    source.schemaVersion === 2 &&
    source.type &&
    source.type.length <= 160 &&
    source.producer?.kind === 'game_plugin' &&
    producer.id &&
    Number.isSafeInteger(producer.epoch) &&
    producer.epoch >= 1 &&
    Number.isSafeInteger(producer.sourceSeq) &&
    producer.sourceSeq >= 1 &&
    source.eventId === sourceEventKey(producer) &&
    runtimeTarget?.runtimeInstanceId &&
    runtimeTarget.libraryGameId &&
    runtimeTarget.pluginInstanceId &&
    runtimeTarget.connectionId &&
    runtimeTarget.id &&
    JSON.stringify(source.data ?? null).length <= 256 * 1024
  )
}

export const GET = defineApiRoute('get:/api/game-agent/activity', async ({ request }) => {
  const search = new URL(request.url).searchParams
  const taskId = search.get('taskId')?.trim()
  const gameId = search.get('gameId')?.trim()
  const runtimeInstanceId = search.get('runtimeInstanceId')?.trim()
  if (!taskId) return apiOk({ tasks: await listAgentActivityTasks(gameId, runtimeInstanceId) })
  if (!gameId) return apiNotFound('Missing game id', 'GAME_ID_REQUIRED')
  if (search.get('format') === 'jsonl') {
    const exported = await exportAgentActivityTask(gameId, taskId, runtimeInstanceId)
    return exported
      ? new Response(exported.content, { headers: { 'Content-Type': exported.mimeType, 'Content-Disposition': `attachment; filename="${exported.filename}"` } })
      : apiNotFound('Agent trace not found', 'AGENT_TASK_NOT_FOUND')
  }
  const task = await readAgentActivityTask(gameId, taskId, runtimeInstanceId)
  return task ? apiOk({ task }) : apiNotFound('Agent task not found', 'AGENT_TASK_NOT_FOUND')
})

export const POST = defineApiRoute('post:/api/game-agent/activity', async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { task?: AgentTask; event?: AgentTaskEvent; sourceEvent?: SourceGameEvent } | null
  if (body?.sourceEvent) {
    const source = body.sourceEvent
    if (!validSourceEvent(source)) return apiBadRequest('Invalid game source event', 'GAME_LOG_EVENT_INVALID')
    try {
      assertGameLogWriterLease(source)
      await appendGameActivitySource(source)
      return apiOk({ stored: true })
    } catch (error) {
      if (error instanceof AgentTraceConflictError) return apiError(409, GAME_LOG_EVENT_CONFLICT, error.message)
      if (error instanceof GameLogWriterLeaseError) return apiError(409, GAME_LOG_WRITER_LEASE_REJECTED, error.message)
      throw error
    }
  }
  if (!body?.task?.id || !body.task.gameId || !body.event || body.event.seq < 1 || !body.event.type) return apiBadRequest('Invalid agent trace event', 'AGENT_TRACE_INVALID')
  if (body.task.id.length > 160 || body.task.gameId.length > 500) return apiBadRequest('Agent trace identifier is too long', 'AGENT_TRACE_INVALID')
  try {
    if (body.event.producer?.kind === 'game_plugin') {
      const source = body.event as unknown as SourceGameEvent
      if (!validSourceEvent(source)) return apiBadRequest('Invalid game source event', 'GAME_LOG_EVENT_INVALID')
      assertGameLogWriterLease(source)
    }
    await appendAgentActivity(body.task, body.event)
  } catch (error) {
    if (error instanceof AgentTraceConflictError) return apiError(409, GAME_LOG_EVENT_CONFLICT, error.message)
    if (error instanceof GameLogWriterLeaseError) return apiError(409, GAME_LOG_WRITER_LEASE_REJECTED, error.message)
    throw error
  }
  return apiOk({ stored: true })
})

export const DELETE = defineApiRoute('delete:/api/game-agent/activity', async ({ request }) => {
  const search = new URL(request.url).searchParams
  const removed = await removeAgentActivity(
    search.get('gameId')?.trim() || undefined,
    search.get('taskId')?.trim() || undefined,
    search.get('runtimeInstanceId')?.trim() || undefined
  )
  return apiOk({ removed })
})
