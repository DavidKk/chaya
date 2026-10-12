import { randomUUID } from 'node:crypto'

import { parsePlayerCard } from '@/lib/game-agent/player-card'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentTaskMessage } from '@/lib/runtime/game-link-protocol'
import { callAgentGame, resolveAgentGame } from '@/services/runtime/agent-bridge'

import { finishTurn } from './session-store'
import type { GameAgentEvent, GameAgentTurn, StartTurnInput } from './types'

type TaskRequest = Exclude<AgentTaskMessage, { type: 'agent.task.result' }>

export function callExtTask(gameId: string, message: TaskRequest, timeoutMs = 15_000): Promise<unknown> {
  return callAgentGame(resolveAgentGame(gameId), 'agent.task', { message }, timeoutMs)
}

export async function listExtTasks(gameId: string, timeoutMs?: number): Promise<AgentTask[]> {
  return (await callExtTask(gameId, { type: 'agent.task.status', requestId: randomUUID() }, timeoutMs)) as AgentTask[]
}

export async function getExtTask(gameId: string, taskId: string, timeoutMs?: number): Promise<AgentTask | null> {
  return (await callExtTask(gameId, { type: 'agent.task.status', requestId: randomUUID(), taskId }, timeoutMs).catch(() => null)) as AgentTask | null
}

export async function startExtPlayTurn(
  input: StartTurnInput,
  turn: GameAgentTurn,
  emit: (event: GameAgentEvent) => void,
  gameCallTimeoutMs?: number,
  modelTimeoutMs = 120_000
): Promise<void> {
  await callExtTask(
    input.gameId,
    {
      type: 'agent.task.start',
      requestId: randomUUID(),
      deadlineAt: Date.now() + modelTimeoutMs,
      taskId: turn.id,
      gameId: input.gameId,
      conversationId: turn.sessionId,
      capability: 'play',
      profileId: input.profileId,
      model: input.model,
      locale: input.locale,
      surface: input.surface || 'sidebar',
      companionCharacter: input.companionCharacter,
      goal: input.prompt,
    },
    gameCallTimeoutMs
  )
  await pumpExtTask(
    input.gameId,
    turn.id,
    turn.abort.signal,
    0,
    (event) => {
      if (event.type === 'turn.completed') finishTurn(turn, 'completed')
      else if (event.type === 'turn.stopped') finishTurn(turn, 'stopped')
      else if (event.type === 'turn.failed') finishTurn(turn, 'failed')
      emit(event)
    },
    gameCallTimeoutMs
  )
}

function mappedEvent(event: AgentTaskEvent): GameAgentEvent | null {
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
  if (event.type === 'assistant.completed') return { type: 'assistant.delta', text: String(data.text || '') }
  if (event.type === 'progress.updated') {
    return {
      type: 'progress.updated',
      summary: String(data.summary || ''),
      cycle: Number(data.cycle) || 0,
      reason: String(data.reason || ''),
      steps: Number(data.steps) || 0,
      toolCalls: Number(data.toolCalls) || 0,
    }
  }
  if (event.type === 'phase') {
    const phase = data.phase
    if (!['observing', 'thinking', 'acting', 'verifying'].includes(String(phase))) return null
    return { type: 'phase', phase: phase as 'observing' | 'thinking' | 'acting' | 'verifying', step: Number(data.step) || 0, maxSteps: Number(data.maxSteps) || 80 }
  }
  if (event.type === 'prompt.recorded') return { type: 'prompt.recorded', role: data.role === 'system' ? 'system' : 'user', content: String(data.content || '') }
  if (event.type === 'model.requested')
    return {
      type: 'model.requested',
      model: typeof data.model === 'string' ? data.model : undefined,
      messageCount: Number(data.messageCount) || 0,
      contextChars: Number(data.contextChars) || 0,
    }
  if (event.type === 'model.completed')
    return {
      type: 'model.completed',
      model: typeof data.model === 'string' ? data.model : undefined,
      text: String(data.text || ''),
      usage: data.usage as import('@/lib/game-agent/activity').AgentTokenUsage,
      durationMs: Number(data.durationMs) || 0,
    }
  if (event.type === 'thought.updated') return { type: 'thought.updated', summary: (data.summary || {}) as import('@/lib/game-agent/activity').AgentThoughtSummary }
  if (event.type === 'tool.started')
    return {
      type: 'tool.started',
      callId: String(data.callId || ''),
      name: String(data.name || ''),
      input: data.input && typeof data.input === 'object' ? (data.input as Record<string, unknown>) : {},
      startedAt: Number(data.startedAt) || event.at,
    }
  if (event.type === 'tool.completed')
    return {
      type: 'tool.completed',
      callId: String(data.callId || ''),
      name: String(data.name || ''),
      ok: data.ok !== false,
      output: data.output,
      durationMs: Number(data.durationMs) || 0,
    }
  if (event.type === 'approval.required') {
    const card = parsePlayerCard(data.card)
    return { type: 'approval.required', question: String(data.question || '请确认是否继续'), ...(card ? { card } : {}) }
  }
  if (event.type === 'card.shown') {
    const card = parsePlayerCard(data.card)
    return card ? { type: 'card.shown', card } : null
  }
  if (event.type === 'user.reply') return { type: 'user.replied', text: String(data.text || '').slice(0, 2_000) }
  if (event.type === 'state.changed' && data.state === 'waiting_user') return { type: 'phase', phase: 'waiting_user', step: 0, maxSteps: 80 }
  return null
}

export async function pumpExtTask(
  gameId: string,
  taskId: string,
  signal: AbortSignal,
  initialSeq: number,
  emit: (event: GameAgentEvent, seq?: number) => void,
  gameCallTimeoutMs?: number
): Promise<void> {
  let seq = initialSeq
  while (!signal.aborted) {
    const result = (await callExtTask(gameId, { type: 'agent.task.events', requestId: randomUUID(), taskId, afterSeq: seq }, gameCallTimeoutMs)) as {
      gap?: boolean
      task: AgentTask
      events?: AgentTaskEvent[]
    }
    if (result.gap) emit({ type: 'history.gap', fromSeq: seq + 1 })
    for (const item of result.events || []) {
      seq = Math.max(seq, item.seq)
      const event = mappedEvent(item)
      if (event) emit(event, item.seq)
    }
    if (result.task.state === 'completed') {
      emit({ type: 'turn.completed', text: '', reason: 'verified' })
      return
    }
    if (result.task.state === 'stopped') {
      emit({ type: 'turn.stopped' })
      return
    }
    if (result.task.state === 'failed' || result.task.state === 'interrupted') {
      emit({
        type: 'turn.failed',
        code: result.task.state === 'interrupted' ? 'AGENT_TASK_INTERRUPTED' : 'AGENT_TURN_FAILED',
        message: result.task.error || (result.task.state === 'interrupted' ? '游戏重载，任务已中断' : 'Agent 任务失败'),
      })
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    })
  }
  throw signal.reason ?? new DOMException('Stopped', 'AbortError')
}
