import { addTokenUsage, type AgentThoughtSummary, type AgentTokenUsage, sanitizeAgentActivity, sanitizeAgentText } from '@/lib/game-agent/activity'
import { AGENT_AUDIT_SCHEMA_VERSION, type AgentAuditHost, type AgentAuditMetadata, type AgentRuntimeIdentity, classificationForEvent, isGameFactType } from '@/lib/game-agent/audit'
import type { PlayerCard } from '@/lib/game-agent/player-card'
import { IdempotentWriteCache } from '@/lib/runtime/recoverable-operation'

import type { AgentTraceArchive } from '../trace'
import type { AgentRoutine, RuntimeMessage } from './types'

export type AgentTaskState = 'running' | 'waiting_user' | 'waiting_service' | 'completed' | 'stopped' | 'failed' | 'interrupted'
export type AgentTaskEvent = { seq: number; type: string; at: number; data?: unknown } & Partial<AgentAuditMetadata>
export type AgentTask = {
  id: string
  gameId: string
  libraryGameId?: string
  runtimeInstanceId?: string
  pluginInstanceId?: string
  connectionId?: string
  conversationId: string
  capability: 'play' | 'ask' | 'companion'
  /** From classify; see docs/technical/game-agent-jobs.md */
  shape?: 'single' | 'batch' | 'open'
  profileId: string
  model: string
  locale?: string
  companionCharacter?: string
  surface?: string
  thinking?: boolean
  routine?: AgentRoutine
  usage?: AgentTokenUsage
  latestThought?: AgentThoughtSummary
  state: AgentTaskState
  goal: string
  createdAt: number
  updatedAt: number
  lastSeq: number
  events: AgentTaskEvent[]
  messages: RuntimeMessage[]
  persistence: 'durable' | 'memory'
  error?: string
}

export type AgentTaskStore = {
  save(task: AgentTask, signal: AbortSignal): Promise<void>
  load(): Promise<AgentTask[]>
  remove?(taskId: string, signal: AbortSignal): Promise<void>
}

export type AgentTaskControllerOptions = {
  now?: () => number
  waitingUserMs?: number
  waitingServiceMs?: number
  /** The ext adapter uses this to arbitrate keyboard ownership with macros and external MCP callers. */
  setInputOwner?: (taskId: string | null) => void
  traceArchive?: AgentTraceArchive
  runtimeIdentity?: AgentRuntimeIdentity
  producerEpoch?: number
  executionHost?: AgentAuditHost
}

const terminal = (state: AgentTaskState) => ['completed', 'stopped', 'failed', 'interrupted'].includes(state)

export class AgentTaskController {
  private readonly tasks = new Map<string, AgentTask>()
  private readonly aborts = new Map<string, AbortController>()
  private readonly writes = new IdempotentWriteCache<AgentTask>(1000)
  private readonly waitingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly replyWaiters = new Map<string, { resolve: (text: string) => void; reject: (error: unknown) => void }>()
  private readonly now: () => number
  private readonly waitingUserMs: number
  private readonly waitingServiceMs: number
  private readonly setInputOwner: (taskId: string | null) => void
  private readonly traceArchive?: AgentTraceArchive
  private readonly runtimeIdentity?: AgentRuntimeIdentity
  private readonly producerEpoch: number
  private readonly executionHost: AgentAuditHost
  private sourceSeq = 0
  private readonly traceDegraded = new Set<string>()

  constructor(
    private readonly store: AgentTaskStore,
    nowOrOptions: (() => number) | AgentTaskControllerOptions = Date.now
  ) {
    const options = typeof nowOrOptions === 'function' ? { now: nowOrOptions } : nowOrOptions
    this.now = options.now ?? Date.now
    this.waitingUserMs = options.waitingUserMs ?? 30 * 60_000
    this.waitingServiceMs = options.waitingServiceMs ?? 60_000
    this.setInputOwner = options.setInputOwner ?? (() => undefined)
    this.traceArchive = options.traceArchive
    this.runtimeIdentity = options.runtimeIdentity
    this.producerEpoch = options.producerEpoch ?? 1
    this.executionHost = options.executionHost ?? 'game_plugin'
  }

  async restore(): Promise<void> {
    const restored = await this.store.load()
    for (const raw of restored.slice(-20)) {
      const task = terminal(raw.state) ? raw : { ...raw, state: 'interrupted' as const, updatedAt: this.now(), error: '宿主已重载，任务已中断' }
      this.tasks.set(task.id, task)
      if (!terminal(raw.state)) await this.persist(task)
    }
  }

  start(input: {
    requestId: string
    deadlineAt: number
    taskId: string
    gameId: string
    conversationId: string
    capability: AgentTask['capability']
    profileId: string
    model: string
    locale?: string
    companionCharacter?: string
    surface?: string
    thinking?: boolean
    shape?: AgentTask['shape']
    routine?: AgentRoutine
    goal: string
    execute: (task: AgentTask, signal: AbortSignal, controller: AgentTaskController) => Promise<void>
  }): Promise<AgentTask> {
    return this.writes.run({ requestId: input.requestId, deadlineAt: input.deadlineAt }, async () => {
      const requestedRuntimeId = this.runtimeIdentity?.runtimeInstanceId
      if ([...this.tasks.values()].some((task) => !terminal(task.state) && (requestedRuntimeId ? task.runtimeInstanceId === requestedRuntimeId : task.gameId === input.gameId))) {
        throw new Error('An agent task is already running for this game, please stop it first')
      }
      const now = this.now()
      const task: AgentTask = {
        id: input.taskId,
        gameId: input.gameId,
        ...(this.runtimeIdentity
          ? {
              libraryGameId: this.runtimeIdentity.libraryGameId,
              runtimeInstanceId: this.runtimeIdentity.runtimeInstanceId,
              pluginInstanceId: this.runtimeIdentity.pluginInstanceId,
              connectionId: this.runtimeIdentity.connectionId,
            }
          : {}),
        conversationId: input.conversationId,
        capability: input.capability,
        profileId: input.profileId,
        model: input.model,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.companionCharacter ? { companionCharacter: input.companionCharacter } : {}),
        ...(input.surface ? { surface: input.surface } : {}),
        ...(input.thinking ? { thinking: true } : {}),
        ...(input.shape ? { shape: input.shape } : {}),
        ...(input.routine ? { routine: input.routine } : {}),
        state: 'running',
        goal: sanitizeAgentText(input.goal),
        createdAt: now,
        updatedAt: now,
        lastSeq: 0,
        events: [],
        messages: [],
        persistence: 'durable',
      }
      this.tasks.set(task.id, task)
      this.emit(task.id, 'prompt.recorded', { role: 'user', content: task.goal, source: input.surface || input.capability })
      const initial = new AbortController()
      const timer = setTimeout(() => initial.abort(new DOMException('初始检查点超时', 'TimeoutError')), 10_000)
      try {
        await this.store.save(task, initial.signal)
      } catch {
        task.persistence = 'memory'
        this.emit(task.id, 'persistence.degraded')
      } finally {
        clearTimeout(timer)
      }
      const controller = new AbortController()
      this.aborts.set(task.id, controller)
      if (task.capability === 'play') this.setInputOwner(task.id)
      void input.execute(task, controller.signal, this).then(
        () => {
          if (!terminal(task.state)) this.finish(task.id, 'completed')
        },
        (error) => {
          if (!terminal(task.state)) this.finish(task.id, controller.signal.aborted ? 'stopped' : 'failed', error instanceof Error ? error.message : String(error))
        }
      )
      return task
    })
  }

  get(taskId: string): AgentTask | null {
    return this.tasks.get(taskId) ?? null
  }

  list(): AgentTask[] {
    return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  setState(taskId: string, state: 'running' | 'waiting_user' | 'waiting_service'): AgentTask {
    const task = this.need(taskId)
    if (terminal(task.state)) throw new Error('Task has already finished')
    this.clearWaitingTimer(taskId)
    task.state = state
    task.updatedAt = this.now()
    this.setInputOwner(task.capability === 'play' && state === 'running' ? taskId : null)
    this.emit(taskId, 'state.changed', { state })
    if (state !== 'running') {
      const delay = state === 'waiting_user' ? this.waitingUserMs : this.waitingServiceMs
      const reason = state === 'waiting_user' ? '等待玩家回复超时' : '无法连接 Chaya 本机服务'
      const timer = setTimeout(() => {
        this.waitingTimers.delete(taskId)
        const current = this.tasks.get(taskId)
        if (current?.state === state) this.finish(taskId, 'failed', reason)
      }, delay)
      ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
      this.waitingTimers.set(taskId, timer)
    }
    void this.persist(task)
    return task
  }

  reply(taskId: string, text: string): AgentTask {
    const task = this.need(taskId)
    if (task.state !== 'waiting_user') throw new Error('Task is not waiting for player reply')
    this.emit(taskId, 'user.reply', { text: text.slice(0, 16_000) })
    const updated = this.setState(taskId, 'running')
    this.replyWaiters.get(taskId)?.resolve(text.slice(0, 16_000))
    this.replyWaiters.delete(taskId)
    return updated
  }

  /** `card` 让界面用小卡片展示问题；玩家点选时回复的是选项 id */
  waitForUser(taskId: string, question: string, signal: AbortSignal, card?: PlayerCard): Promise<string> {
    if (this.replyWaiters.has(taskId)) throw new Error('Task is already waiting for player reply')
    this.emit(taskId, 'approval.required', { question: question.slice(0, 2_000), ...(card ? { card } : {}) })
    this.setState(taskId, 'waiting_user')
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.replyWaiters.delete(taskId)
        reject(signal.reason ?? new DOMException('Stopped', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.replyWaiters.set(taskId, {
        resolve: (text) => {
          signal.removeEventListener('abort', abort)
          resolve(text)
        },
        reject,
      })
    })
  }

  appendMessages(taskId: string, messages: RuntimeMessage[]): void {
    const task = this.need(taskId)
    task.messages.push(...(sanitizeAgentActivity(messages) as RuntimeMessage[]))
    task.messages = task.messages.slice(-40)
    task.updatedAt = this.now()
    void this.persist(task)
  }

  checkpoint(taskId: string): void {
    const task = this.need(taskId)
    task.updatedAt = this.now()
    void this.persist(task)
  }

  stop(taskId: string): AgentTask {
    const task = this.need(taskId)
    if (terminal(task.state)) return task
    this.aborts.get(taskId)?.abort(new DOMException('Stopped', 'AbortError'))
    return this.finish(taskId, 'stopped')
  }

  interruptAll(reason = '宿主已关闭，任务已中断'): void {
    for (const task of this.tasks.values()) {
      if (terminal(task.state)) continue
      this.aborts.get(task.id)?.abort(new DOMException(reason, 'AbortError'))
      this.aborts.delete(task.id)
      this.clearWaitingTimer(task.id)
      this.replyWaiters.get(task.id)?.reject(new DOMException(reason, 'AbortError'))
      this.replyWaiters.delete(task.id)
      task.state = 'interrupted'
      task.error = reason
      task.updatedAt = this.now()
      this.emit(task.id, 'task.interrupted', { error: reason })
      void this.persist(task)
    }
    this.setInputOwner(null)
  }

  finish(taskId: string, state: Extract<AgentTaskState, 'completed' | 'stopped' | 'failed'>, error?: string): AgentTask {
    const task = this.need(taskId)
    if (terminal(task.state)) return task
    const execution = this.aborts.get(taskId)
    if (execution && !execution.signal.aborted) execution.abort(new DOMException(error || `任务已${state}`, 'AbortError'))
    this.clearWaitingTimer(taskId)
    this.replyWaiters.get(taskId)?.reject(new DOMException('Task has already finished', 'AbortError'))
    this.replyWaiters.delete(taskId)
    if (task.capability === 'play') this.setInputOwner(null)
    task.state = state
    task.error = error
    task.updatedAt = this.now()
    this.aborts.delete(taskId)
    this.emit(taskId, `task.${state}`, error ? { error } : undefined)
    void this.persist(task)
    return task
  }

  async clear(taskId?: string): Promise<number> {
    const targets = taskId ? [this.need(taskId)] : this.list()
    for (const task of targets) {
      if (!terminal(task.state)) this.stop(task.id)
      this.clearWaitingTimer(task.id)
      this.replyWaiters.get(task.id)?.reject(new DOMException('任务已清理', 'AbortError'))
      this.replyWaiters.delete(task.id)
      this.tasks.delete(task.id)
      if (this.store.remove) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        try {
          await this.store.remove(task.id, controller.signal)
        } catch {
          /* Clearing local runtime state must win even when durable storage is unavailable. */
        } finally {
          clearTimeout(timer)
        }
      }
    }
    return targets.length
  }

  emit(taskId: string, type: string, data?: unknown): AgentTaskEvent {
    const task = this.need(taskId)
    const safeData = data === undefined ? undefined : sanitizeAgentActivity(data)
    if (type === 'usage.updated') task.usage = addTokenUsage(task.usage, safeData as AgentTokenUsage)
    if (type === 'thought.updated' && safeData && typeof safeData === 'object') task.latestThought = (safeData as { summary?: AgentThoughtSummary }).summary
    const taskSeq = ++task.lastSeq
    const sourceSeq = ++this.sourceSeq
    const gameFact = isGameFactType(type)
    const producerId = gameFact ? task.pluginInstanceId || 'game-plugin' : 'agent-coordinator'
    const event: AgentTaskEvent = {
      schemaVersion: AGENT_AUDIT_SCHEMA_VERSION,
      eventId: `${producerId}:${this.producerEpoch}:${sourceSeq}`,
      seq: taskSeq,
      taskSeq,
      type,
      at: this.now(),
      producer: { id: producerId, kind: gameFact ? 'game_plugin' : 'agent_coordinator', epoch: this.producerEpoch, sourceSeq },
      execution: { host: this.executionHost, component: gameFact ? 'game-runtime-observer' : 'agent-task-controller' },
      classification: classificationForEvent(type),
      targets: this.targets(task),
      correlation: {
        conversationId: task.conversationId,
        taskId: task.id,
        ...this.correlation(safeData),
      },
      ...(safeData === undefined ? {} : { data: safeData }),
    }
    task.events.push(event)
    if (task.events.length > 200) task.events.shift()
    task.updatedAt = event.at
    if (this.traceArchive) {
      void this.traceArchive.append(task, event).catch(() => {
        if (type === 'trace.degraded' || this.traceDegraded.has(taskId)) return
        this.traceDegraded.add(taskId)
        this.emit(taskId, 'trace.degraded', { reason: '长期轨迹写入失败，本次任务仍会继续。' })
      })
    }
    return event
  }

  private targets(task: AgentTask): AgentAuditMetadata['targets'] {
    const runtimeInstanceId = task.runtimeInstanceId || task.gameId
    return [
      {
        kind: 'runtime',
        id: runtimeInstanceId,
        libraryGameId: task.libraryGameId || task.gameId,
        runtimeInstanceId,
        ...(task.pluginInstanceId ? { pluginInstanceId: task.pluginInstanceId } : {}),
        ...(task.connectionId ? { connectionId: task.connectionId } : {}),
      },
    ]
  }

  private correlation(data: unknown): Pick<AgentAuditMetadata['correlation'], 'actionId' | 'parentActionId' | 'toolCallId'> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const value = data as Record<string, unknown>
    return {
      ...(typeof value.actionId === 'string' ? { actionId: value.actionId } : {}),
      ...(typeof value.parentActionId === 'string' ? { parentActionId: value.parentActionId } : {}),
      ...(typeof value.callId === 'string' ? { toolCallId: value.callId } : {}),
    }
  }

  events(taskId: string, afterSeq: number): { gap: boolean; task: AgentTask; events: AgentTaskEvent[] } {
    const task = this.need(taskId)
    const first = task.events[0]?.seq ?? task.lastSeq + 1
    return { gap: afterSeq < first - 1, task, events: task.events.filter((event) => event.seq > afterSeq) }
  }

  private need(taskId: string): AgentTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    return task
  }

  private clearWaitingTimer(taskId: string): void {
    const timer = this.waitingTimers.get(taskId)
    if (timer) clearTimeout(timer)
    this.waitingTimers.delete(taskId)
  }

  private async persist(task: AgentTask): Promise<void> {
    if (task.persistence !== 'durable') return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      await this.store.save(task, controller.signal)
    } catch {
      task.persistence = 'memory'
      this.emit(task.id, 'persistence.degraded')
    } finally {
      clearTimeout(timer)
    }
  }
}
