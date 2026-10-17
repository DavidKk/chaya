import {
  candidateFromEvent,
  formatJobReply,
  INTERACT_BATCH_FORMAT,
  INTERACT_BATCH_PLAN_SYSTEM,
  type JobIo,
  type JobOutcome,
  type JobRun,
  mapInteractOutcome,
  parseInteractBatchSpec,
  type PendingJob,
  planUserContent,
  readMapId,
  readVisibleBounds,
  runJobs,
  sanitizeSpecIds,
} from '@/lib/game-agent/jobs'
import type { AgentTask, RuntimeMessage } from '@/lib/game-agent/runtime'
import type { AgentCommand } from '@/lib/runtime/agent-protocol'

import { readAgentGameState, runAgentCommand } from '../handlers'

type Complete = (messages: RuntimeMessage[], tools: [], signal: AbortSignal, format?: Record<string, unknown>) => Promise<RuntimeMessage>

type Emit = (type: string, data?: Record<string, unknown>) => void

function createJobIo(task: AgentTask, emit: Emit, waitForUser: (question: string, signal: AbortSignal) => Promise<string>): JobIo {
  let seq = 0
  return {
    checkAbortAndBudget(run, signal) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('任务已停止', 'AbortError')
      if (Date.now() > run.deadline) throw new DOMException('任务超时', 'AbortError')
    },
    async observe() {
      return readAgentGameState()
    },
    withinBoundary(state, run) {
      const mapId = readMapId(state)
      return mapId != null && mapId === run.boundary.startMapId
    },
    async interact(job, _opts, signal) {
      if (signal.aborted) throw signal.reason
      const startedAt = Date.now()
      const callId = `batch-${++seq}`
      emit('tool.started', { name: 'chaya_live_interact', callId, input: { eventId: job.eventId, openDoors: false }, startedAt })
      let output: unknown
      let ok = true
      try {
        output = await runAgentCommand({ id: `task-${task.id}-${callId}`, method: 'player.interact', params: { eventId: job.eventId, openDoors: false } } as AgentCommand, {
          inputOwner: task.id,
        })
      } catch (error) {
        ok = false
        output = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      emit('tool.completed', { name: 'chaya_live_interact', callId, ok, output, durationMs: Date.now() - startedAt })
      const state = readAgentGameState()
      // boundary is read from the active run via closure in createJobIo — checked in runJobs after return
      return mapInteractOutcome(job, output, {
        inBattle: Boolean((state as { battle?: unknown }).battle),
      })
    },
    async continuePending(run, state, signal) {
      if (!run.pending) return { status: 'stopped', reason: 'effect_unknown' }
      if (signal.aborted) throw signal.reason
      const message = (state as { message?: { busy?: boolean; choices?: unknown[] } } | null)?.message
      if (message?.choices?.length) return { status: 'needs_decision', reason: 'choice', state }
      if (message?.busy) return { status: 'needs_decision', reason: 'input_required', state }
      return {
        status: 'done',
        evidence: { messages: [], goldChange: 0, inventoryChanges: [], historyRange: { fromSeq: null, toSeq: 0 }, completeness: { messagesTruncated: false, historyGap: false } },
      }
    },
    createPending(job, result, version): PendingJob {
      return { job, reason: result.reason, version }
    },
    async askPlayer(_run, question, signal) {
      await waitForUser(question, signal)
      return 'continue'
    },
  }
}

function seedRun(task: AgentTask, spec: JobRun['spec'], state: unknown): JobRun | null {
  const mapId = readMapId(state)
  const bounds = readVisibleBounds(state)
  if (mapId == null || !bounds) return null
  const known = new Set<number>()
  const candidates = new Map<number, NonNullable<ReturnType<typeof candidateFromEvent>>>()
  const events = Array.isArray((state as { nearbyEvents?: unknown }).nearbyEvents) ? ((state as { nearbyEvents: unknown[] }).nearbyEvents as Record<string, unknown>[]) : []
  for (const event of events) {
    const candidate = candidateFromEvent(event, mapId, state)
    if (!candidate) continue
    known.add(candidate.eventId)
    candidates.set(candidate.eventId, candidate)
  }
  return {
    spec: sanitizeSpecIds(spec, known),
    specVersion: 1,
    boundary: {
      runtimeInstanceId: task.gameId,
      startMapId: mapId,
      startVisibleBounds: bounds,
    },
    candidates,
    ledger: new Map(),
    failures: new Map(),
    log: [],
    attempts: 0,
    deadline: Date.now() + 5 * 60_000,
  }
}

function outcomeText(outcome: JobOutcome): string {
  const base = formatJobReply(outcome.run)
  if (outcome.status === 'completed') return base
  if (outcome.status === 'partial') return `${base}（部分完成${outcome.reason ? `：${outcome.reason}` : ''}）`
  if (outcome.status === 'out_of_scope') return `${base}（已离开起始范围，已停止）`
  if (outcome.status === 'unreachable') return `${base}（剩余目标不可达）`
  if (outcome.status === 'limit') return `${base}（达到步数或时间上限）`
  if (outcome.status === 'waiting_user') return outcome.question
  return `${base}（已停止）`
}

/**
 * Try the batch interact path. Returns null when the request should fall through to runAgentTurn.
 */
export async function tryRunInteractBatch(
  task: AgentTask,
  complete: Complete,
  emit: Emit,
  waitForUser: (question: string, signal: AbortSignal) => Promise<string>,
  signal: AbortSignal
): Promise<{ text: string; reason: string } | null> {
  if (task.capability !== 'play' && task.capability !== 'companion') return null
  // Only enter when classify explicitly chose batch (avoids an extra plan call on every play turn).
  if (task.shape !== 'batch') return null
  const state = readAgentGameState()
  if ((state as { scene?: string }).scene !== 'Scene_Map' || (state as { battle?: unknown }).battle) return null

  emit('phase', { phase: 'thinking', step: 0, maxSteps: 1 })
  const planned = await complete(
    [
      { role: 'system', content: `/no_think\n${INTERACT_BATCH_PLAN_SYSTEM}` },
      { role: 'user', content: planUserContent(task.goal, state) },
    ],
    [],
    signal,
    INTERACT_BATCH_FORMAT as unknown as Record<string, unknown>
  )
  emit('model.completed', {
    model: task.model,
    text: planned.content,
    usage: planned.usage,
    ...(planned.timing ? { timing: planned.timing } : {}),
    durationMs: 0,
  })

  const parsed = parseInteractBatchSpec(planned.content)
  if (!parsed.ok) return null
  if (parsed.spec.cardinality !== 'many') return null

  const run = seedRun(task, parsed.spec, state)
  if (!run) return null
  emit('progress.updated', { summary: parsed.spec.summary, cycle: 0, steps: 0, toolCalls: 0 })

  const io = createJobIo(task, emit, waitForUser)
  const outcome = await runJobs(run, io, signal)
  if (outcome.status === 'waiting_user') {
    await waitForUser(outcome.question, signal)
    const continued = await runJobs(outcome.run, io, signal)
    return { text: outcomeText(continued), reason: continued.status === 'completed' ? 'answered' : continued.status }
  }
  return { text: outcomeText(outcome), reason: outcome.status === 'completed' ? 'answered' : outcome.status }
}
