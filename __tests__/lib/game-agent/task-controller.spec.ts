import { type AgentTask, AgentTaskController, type AgentTaskStore } from '@/lib/game-agent/runtime'
import type { AgentTraceArchive } from '@/lib/game-agent/trace'

const input = (execute: (task: AgentTask, signal: AbortSignal, controller: AgentTaskController) => Promise<void>) => ({
  requestId: 'r1',
  deadlineAt: Date.now() + 60_000,
  taskId: 't1',
  gameId: 'g1',
  conversationId: 'c1',
  capability: 'play' as const,
  profileId: 'profile',
  model: 'model',
  goal: 'go',
  execute,
})

describe('agent task controller', () => {
  const store = (): AgentTaskStore => ({ save: jest.fn(async () => undefined), load: jest.fn(async () => []) })

  it('deduplicates starts and allows only one non-terminal Agent task per game', async () => {
    const controller = new AgentTaskController(store())
    const pending = async () => new Promise<void>(() => undefined)
    const first = await controller.start(input(pending))
    expect(await controller.start(input(pending))).toBe(first)
    await expect(controller.start({ ...input(pending), requestId: 'r2', taskId: 't2', capability: 'companion' })).rejects.toThrow('已有 Agent 任务')
    controller.stop('t1')
    await expect(controller.start({ ...input(pending), requestId: 'r3', taskId: 't3' })).resolves.toMatchObject({ id: 't3' })
  })

  it('writes v2 producer, runtime target, and correlation metadata', async () => {
    const controller = new AgentTaskController(store(), {
      runtimeIdentity: {
        libraryGameId: 'library-1',
        runtimeInstanceId: 'runtime-1',
        pluginInstanceId: 'plugin-1',
        connectionId: 'connection-1',
      },
      producerEpoch: 7,
      executionHost: 'game_plugin',
    })
    const task = await controller.start(input(async () => new Promise<void>(() => undefined)))
    const agentEvent = task.events[0]!
    const gameEvent = controller.emit(task.id, 'game.dialogue', { actionId: 'action-1', callId: 'call-1', text: 'hello' })

    expect(task).toMatchObject({
      libraryGameId: 'library-1',
      runtimeInstanceId: 'runtime-1',
      pluginInstanceId: 'plugin-1',
      connectionId: 'connection-1',
    })
    expect(agentEvent).toMatchObject({ schemaVersion: 2, taskSeq: 1, producer: { kind: 'agent_coordinator', epoch: 7, sourceSeq: 1 } })
    expect(gameEvent).toMatchObject({
      schemaVersion: 2,
      taskSeq: 2,
      producer: { id: 'plugin-1', kind: 'game_plugin', epoch: 7, sourceSeq: 2 },
      execution: { host: 'game_plugin', component: 'game-runtime-observer' },
      classification: { domain: 'game_runtime', type: 'game.dialogue', effect: 'runtime_change' },
      targets: [expect.objectContaining({ libraryGameId: 'library-1', runtimeInstanceId: 'runtime-1', pluginInstanceId: 'plugin-1' })],
      correlation: { taskId: 't1', actionId: 'action-1', toolCallId: 'call-1' },
    })
  })

  it('stop wins over a late executor completion', async () => {
    let complete = () => {}
    const controller = new AgentTaskController(store())
    const task = await controller.start(input(async () => new Promise<void>((resolve) => (complete = resolve))))
    controller.stop(task.id)
    complete()
    await Promise.resolve()
    expect(controller.get(task.id)?.state).toBe('stopped')
  })

  it('reports event gaps and restores running tasks as interrupted', async () => {
    const saved = { ...(await new AgentTaskController(store()).start(input(async () => undefined))), state: 'waiting_service' as const }
    const persistence = store()
    ;(persistence.load as jest.Mock).mockResolvedValue([saved])
    const controller = new AgentTaskController(persistence)
    await controller.restore()
    expect(controller.get('t1')?.state).toBe('interrupted')
    for (let index = 0; index < 201; index++) controller.emit('t1', 'progress', index)
    expect(controller.events('t1', 0)).toMatchObject({ gap: true, events: { length: 200 } })
  })

  it('releases input while waiting, reacquires it on reply, and times out waiting for the user', async () => {
    jest.useFakeTimers()
    const owners: Array<string | null> = []
    const controller = new AgentTaskController(store(), { waitingUserMs: 100, setInputOwner: (owner) => owners.push(owner) })
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    controller.setState('t1', 'waiting_user')
    expect(owners).toEqual(['t1', null])
    controller.reply('t1', 'continue')
    expect(controller.get('t1')?.state).toBe('running')
    expect(owners.at(-1)).toBe('t1')
    controller.setState('t1', 'waiting_user')
    jest.advanceTimersByTime(100)
    expect(controller.get('t1')).toMatchObject({ state: 'failed', error: '等待玩家回复超时' })
    expect(owners.at(-1)).toBeNull()
    jest.useRealTimers()
  })

  it('recovers waiting-service ownership and lets stop preempt its timeout', async () => {
    jest.useFakeTimers()
    const owners: Array<string | null> = []
    const controller = new AgentTaskController(store(), { waitingServiceMs: 100, setInputOwner: (owner) => owners.push(owner) })
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    controller.setState('t1', 'waiting_service')
    expect(controller.get('t1')?.state).toBe('waiting_service')
    expect(owners.at(-1)).toBeNull()
    controller.setState('t1', 'running')
    expect(owners.at(-1)).toBe('t1')
    jest.advanceTimersByTime(100)
    expect(controller.get('t1')?.state).toBe('running')

    controller.setState('t1', 'waiting_service')
    controller.stop('t1')
    jest.advanceTimersByTime(100)
    expect(controller.get('t1')?.state).toBe('stopped')
    expect(owners.at(-1)).toBeNull()
    jest.useRealTimers()
  })

  it('fails waiting-service tasks after the bounded retry window', async () => {
    jest.useFakeTimers()
    const controller = new AgentTaskController(store(), { waitingServiceMs: 100 })
    let executionSignal: AbortSignal | undefined
    await controller.start(
      input(async (_task, signal) => {
        executionSignal = signal
        return new Promise<void>(() => undefined)
      })
    )
    controller.setState('t1', 'waiting_service')
    jest.advanceTimersByTime(100)
    expect(controller.get('t1')).toMatchObject({ state: 'failed', error: '无法连接 Chaya 本机服务' })
    expect(executionSignal?.aborted).toBe(true)
    jest.useRealTimers()
  })

  it('resolves a waiting-user promise and persists bounded conversation messages', async () => {
    const persistence = store()
    const controller = new AgentTaskController(persistence)
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    const waiting = controller.waitForUser('t1', 'continue?', new AbortController().signal)
    controller.reply('t1', 'yes')
    await expect(waiting).resolves.toBe('yes')
    controller.appendMessages(
      't1',
      Array.from({ length: 45 }, (_, index) => ({ role: 'assistant' as const, content: String(index) }))
    )
    expect(controller.get('t1')?.messages).toHaveLength(40)
    expect(controller.get('t1')?.messages[0]?.content).toBe('5')
    expect(persistence.save).toHaveBeenCalled()
  })

  it('redacts task text before persistence and reports a later persistence failure', async () => {
    const persistence = store()
    ;(persistence.save as jest.Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk unavailable'))
    const controller = new AgentTaskController(persistence)
    const task = await controller.start({ ...input(async () => new Promise<void>(() => undefined)), goal: 'token=private at /Users/alice/game' })
    controller.appendMessages(task.id, [{ role: 'assistant', content: 'Bearer hidden at /tmp/output.json' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.get(task.id)).toMatchObject({
      goal: 'token=[REDACTED] at <local-path>',
      messages: [{ role: 'assistant', content: 'Bearer [REDACTED] at <local-path>' }],
      persistence: 'memory',
    })
    expect(controller.get(task.id)?.events).toContainEqual(expect.objectContaining({ type: 'persistence.degraded' }))
  })

  it('clears memory state even when durable removal fails', async () => {
    const persistence = { ...store(), remove: jest.fn(async () => Promise.reject(new Error('disk unavailable'))) }
    const controller = new AgentTaskController(persistence)
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    await expect(controller.clear()).resolves.toBe(1)
    expect(controller.list()).toEqual([])
  })

  it('archives emitted events without deleting long-term traces when recent tasks are cleared', async () => {
    const archive: AgentTraceArchive = {
      append: jest.fn(async () => undefined),
      list: jest.fn(async () => []),
      read: jest.fn(async () => null),
      export: jest.fn(async () => null),
      remove: jest.fn(async () => 0),
    }
    const controller = new AgentTaskController(store(), { traceArchive: archive })
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    controller.emit('t1', 'agent.observation', { summary: '看见宝箱' })
    await Promise.resolve()
    expect(archive.append).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), expect.objectContaining({ type: 'agent.observation' }))

    await controller.clear('t1')
    expect(archive.remove).not.toHaveBeenCalled()
  })

  it('reports one archive degradation event without changing task execution', async () => {
    const archive: AgentTraceArchive = {
      append: jest.fn(async () => Promise.reject(new Error('archive unavailable'))),
      list: jest.fn(async () => []),
      read: jest.fn(async () => null),
      export: jest.fn(async () => null),
      remove: jest.fn(async () => 0),
    }
    const controller = new AgentTaskController(store(), { traceArchive: archive })
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    controller.emit('t1', 'agent.observation')
    controller.emit('t1', 'agent.decision')
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.get('t1')?.state).toBe('running')
    expect(controller.get('t1')?.events.filter((event) => event.type === 'trace.degraded')).toHaveLength(1)
  })

  it('keeps interrupted tasks for recovery when the host shuts down', async () => {
    const persistence = store()
    const controller = new AgentTaskController(persistence)
    await controller.start(input(async () => new Promise<void>(() => undefined)))
    controller.interruptAll('reload')
    expect(controller.get('t1')).toMatchObject({ state: 'interrupted', error: 'reload' })
    expect(persistence.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 't1', state: 'interrupted' }), expect.any(AbortSignal))
  })
})
