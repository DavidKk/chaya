import type { SourceGameEvent } from './audit'
import type { AgentTask, AgentTaskEvent } from './runtime/task-controller'

export type AgentTraceSummary = Omit<AgentTask, 'events' | 'messages'> & {
  eventCount: number
  sizeBytes: number
}

export type AgentTraceExport = {
  filename: string
  mimeType: 'application/x-ndjson'
  content: string
}

export type AgentTraceArchive = {
  append(task: AgentTask, event: AgentTaskEvent): Promise<void>
  appendSource?(event: SourceGameEvent): Promise<void>
  list(): Promise<AgentTraceSummary[]>
  read(taskId: string): Promise<AgentTask | null>
  export(taskId: string): Promise<AgentTraceExport | null>
  remove(taskId?: string): Promise<number>
}

export const GAME_LOG_EVENT_CONFLICT = 'GAME_LOG_EVENT_CONFLICT'

export class AgentTraceConflictError extends Error {
  readonly code = GAME_LOG_EVENT_CONFLICT

  constructor(readonly eventKey: string) {
    super(`日志事件键冲突：${eventKey}`)
    this.name = 'AgentTraceConflictError'
  }
}

export const AGENT_TRACE_MAX_AGE_MS = 30 * 24 * 60 * 60_000
export const AGENT_TRACE_MAX_BYTES = 100 * 1024 * 1024

const terminal = (state: string) => ['completed', 'stopped', 'failed', 'interrupted'].includes(state)

export function traceCleanupIds(summaries: readonly AgentTraceSummary[], now = Date.now(), maxAgeMs = AGENT_TRACE_MAX_AGE_MS, maxBytes = AGENT_TRACE_MAX_BYTES): string[] {
  let total = summaries.reduce((sum, item) => sum + item.sizeBytes, 0)
  const removals: string[] = []
  for (const item of [...summaries].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (!terminal(item.state)) continue
    if (now - item.updatedAt <= maxAgeMs && total <= maxBytes) continue
    removals.push(item.id)
    total -= item.sizeBytes
  }
  return removals
}

export function traceSummary(task: AgentTask, eventCount = task.lastSeq, sizeBytes = 0): AgentTraceSummary {
  const { events: _events, messages: _messages, ...summary } = task
  return { ...summary, eventCount, sizeBytes }
}

export function traceExport(task: AgentTask): AgentTraceExport {
  const summary = traceSummary(task, task.events.length)
  const lines = [JSON.stringify({ version: 2, kind: 'task', task: summary }), ...task.events.map((event) => JSON.stringify({ version: 2, kind: 'event', taskId: task.id, event }))]
  return { filename: `agent-trace-${task.id}.jsonl`, mimeType: 'application/x-ndjson', content: `${lines.join('\n')}\n` }
}

export function traceEventKey(taskId: string, event: AgentTaskEvent): string {
  return event.eventId || `${taskId}:${event.taskSeq || event.seq}`
}

export function sameTraceEvent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
