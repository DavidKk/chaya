import { IdempotentWriteCache } from '@/lib/runtime/recoverable-operation'

import type { RuntimeMessage } from './types'

export type AgentTaskState = 'running' | 'waiting_user' | 'waiting_service' | 'completed' | 'stopped' | 'failed' | 'interrupted'
export type AgentTaskEvent = { seq: number; type: string; at: number; data?: unknown }
export type AgentTask = {
  id: string
  gameId: string
  conversationId: string
  capability: 'play' | 'ask' | 'companion'
  profileId: string
  model: string
  locale?: string
  companionCharacter?: string
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

  constructor(
    private readonly store: AgentTaskStore,
    nowOrOptions: (() => number) | AgentTaskControllerOptions = Date.now
  ) {
    const options = typeof nowOrOptions === 'function' ? { now: nowOrOptions } : nowOrOptions
    this.now = options.now ?? Date.now
    this.waitingUserMs = options.waitingUserMs ?? 30 * 60_000
    this.waitingServiceMs = options.waitingServiceMs ?? 60_000
    this.setInputOwner = options.setInputOwner ?? (() => undefined)
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
    goal: string
    execute: (task: AgentTask, signal: AbortSignal, controller: AgentTaskController) => Promise<void>
  }): Promise<AgentTask> {
    return this.writes.run({ requestId: input.requestId, deadlineAt: input.deadlineAt }, async () => {
      if ([...this.tasks.values()].some((task) => task.gameId === input.gameId && !terminal(task.state))) {
        throw new Error('当前游戏已有 Agent 任务在运行，请先停止')
      }
      const now = this.now()
      const task: AgentTask = {
        id: input.taskId,
        gameId: input.gameId,
        conversationId: input.conversationId,
        capability: input.capability,
        profileId: input.profileId,
        model: input.model,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.companionCharacter ? { companionCharacter: input.companionCharacter } : {}),
        state: 'running',
        goal: input.goal,
        createdAt: now,
        updatedAt: now,
        lastSeq: 0,
        events: [],
        messages: [],
        persistence: 'durable',
      }
      this.tasks.set(task.id, task)
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
    if (terminal(task.state)) throw new Error('任务已结束')
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
    if (task.state !== 'waiting_user') throw new Error('任务当前不等待玩家回复')
    this.emit(taskId, 'user.reply', { text: text.slice(0, 16_000) })
    const updated = this.setState(taskId, 'running')
    this.replyWaiters.get(taskId)?.resolve(text.slice(0, 16_000))
    this.replyWaiters.delete(taskId)
    return updated
  }

  waitForUser(taskId: string, question: string, signal: AbortSignal): Promise<string> {
    if (this.replyWaiters.has(taskId)) throw new Error('任务已在等待玩家回复')
    this.emit(taskId, 'approval.required', { question: question.slice(0, 2_000) })
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
    task.messages.push(...messages)
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
    this.replyWaiters.get(taskId)?.reject(new DOMException('任务已结束', 'AbortError'))
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
    const event = { seq: ++task.lastSeq, type, at: this.now(), ...(data === undefined ? {} : { data }) }
    task.events.push(event)
    if (task.events.length > 200) task.events.shift()
    task.updatedAt = event.at
    return event
  }

  events(taskId: string, afterSeq: number): { gap: boolean; task: AgentTask; events: AgentTaskEvent[] } {
    const task = this.need(taskId)
    const first = task.events[0]?.seq ?? task.lastSeq + 1
    return { gap: afterSeq < first - 1, task, events: task.events.filter((event) => event.seq > afterSeq) }
  }

  private need(taskId: string): AgentTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('任务不存在')
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
    } finally {
      clearTimeout(timer)
    }
  }
}
