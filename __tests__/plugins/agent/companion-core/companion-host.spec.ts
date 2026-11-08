import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import { createGameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { FactView } from '@/lib/game-agent/companion/types'
import type { AgentTask, RuntimeMessage } from '@/lib/game-agent/runtime'
import type { CompanionEventBatch, CompanionHostRequest, CompanionRouteResult } from '@/lib/runtime/companion-protocol'
import type { CompanionComplete } from '@/plugins/mv/src/agent/runtime/companion-chat'
import { createCompanionHost } from '@/plugins/mv/src/agent/runtime/companion-host'

import { battleFrame } from '../../../lib/game-agent/companion/core/fixtures'

const selection = { profileId: 'p1', model: 'small', locale: 'zh', character: 'rin', conversationId: 'c1' }
const controlReply = JSON.stringify({ kind: 'control', action: 'battle', shape: 'open', lifetime: 'goal', question: null })
const reply = (content: string): RuntimeMessage => ({ role: 'assistant', content })
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

async function setup() {
  let snapshot = emptyMemorySnapshot()
  const memory = createGameplayMemoryStore({
    backend: {
      ready: async () => {},
      flush: async () => {},
      loadSnapshot: async () => structuredClone(snapshot),
      commitBatch: async () => {},
      clearQueueBarrier: async () => {},
    },
  })
  await memory.ready()
  let view = {
    stamp: battleFrame().stamp,
    capabilities: {},
    current: {
      scene: { known: true, value: 'battle' },
      encounterId: { known: true, value: 'enc-1' },
      party: { known: true, value: [] },
      enemies: { known: true, value: [] },
      legalActions: { known: true, value: [] },
    },
    mechanics: { skills: {}, states: {}, spoilerFilterApplied: false },
  } as unknown as FactView
  const jobs: Array<{
    messages: RuntimeMessage[]
    options: Parameters<CompanionComplete>[1]
    resolve: (message: RuntimeMessage) => void
  }> = []
  const complete = jest.fn<ReturnType<CompanionComplete>, Parameters<CompanionComplete>>((messages, options) => new Promise((resolve) => jobs.push({ messages, options, resolve })))
  const startControl = jest.fn(async () => ({ id: 'task-1' }) as unknown as AgentTask)
  const battle = { tacticRevision: 3, lastActionReason: 'heal threatened ally' }
  const host = createCompanionHost({
    memory,
    facts: { current: () => view, subscribe: () => () => {} },
    complete,
    startControl,
    stopExternalControl: jest.fn(),
    libraryGameId: 'g1',
    getBattleContext: () => battle,
  })
  const dispatch = (message: CompanionHostRequest) => host.dispatch(message, false)
  return {
    memory,
    host,
    complete: complete as CompanionComplete,
    jobs,
    startControl,
    battle,
    dispatch,
    route: (id: string) => dispatch({ type: 'agent.companion.route', requestId: id, prompt: '帮我打完这场战斗', ...selection }),
    chat: (id: string) => dispatch({ type: 'agent.companion.chat', requestId: id, prompt: id, stamp: view.stamp, ...selection }),
    changeEpoch: () => {
      view = { ...view, stamp: { ...view.stamp, contextEpoch: view.stamp.contextEpoch + 1 } }
    },
    changeMemory: async (action: 'clear' | 'recording') => {
      snapshot = {
        ...snapshot,
        memoryEpoch: snapshot.memoryEpoch + (action === 'clear' ? 1 : 0),
        recordingRevision: snapshot.recordingRevision + (action === 'recording' ? 1 : 0),
        recordingEnabled: action === 'recording' ? false : snapshot.recordingEnabled,
      }
      await memory.synchronize()
    },
    events: () =>
      dispatch({
        type: 'agent.companion.events',
        requestId: 'events',
        afterSeq: 0,
        consumerId: 'test',
        visible: false,
        ...selection,
      }) as Promise<CompanionEventBatch>,
    close: async () => {
      host.dispose()
      await memory.close()
    },
  }
}

test('a route invalidated during cold startup never proceeds to generation or control', async () => {
  const s = await setup()
  let finishLoading!: () => void
  s.complete.ensureReady = (options) =>
    new Promise<void>((resolve) => {
      options.onModelStatus?.({ phase: 'loading', residency: 'cold' })
      finishLoading = resolve
    })
  try {
    const rejected = expect(s.route('cold-route')).rejects.toBeDefined()
    expect(s.jobs).toHaveLength(0)
    expect((await s.events()).events).toContainEqual(
      expect.objectContaining({ kind: 'model.status', requestId: 'cold-route', modelStatus: { phase: 'loading', residency: 'cold' } })
    )
    s.host.invalidateControl()
    finishLoading()
    await rejected
    expect(s.jobs).toHaveLength(0)
    expect(s.startControl).not.toHaveBeenCalled()
  } finally {
    await s.close()
  }
})

test('preserves the original custody goal and its travel restrictions through ticket execution', async () => {
  const session = await setup()
  const prompt = '全剧情托管，先处理当前这一层，不要上上一层'
  try {
    const route = (await session.dispatch({ type: 'agent.companion.route', requestId: 'custody', prompt, ...selection })) as CompanionRouteResult
    expect(route.kind).toBe('control')
    if (route.kind !== 'control') throw new Error('Expected custody ticket')
    expect(route.goal).toBe(prompt)
    expect(session.jobs).toHaveLength(0)
    await session.dispatch({ type: 'agent.companion.control.start', requestId: 'start', ticketId: route.ticketId })
    expect(session.startControl).toHaveBeenCalledWith(expect.objectContaining({ action: 'custody', goal: prompt }), false, undefined)
  } finally {
    await session.close()
  }
})

test.each(['goal', 'until_stopped'] as const)('control ticket dispatches the trusted battle goal once with lifetime %s', async (lifetime) => {
  const s = await setup()
  try {
    const prompt = lifetime === 'goal' ? '帮我打完这场战斗，结束就停' : '请一直代打遇到的战斗，直到我叫停'
    const routing = s.dispatch({ type: 'agent.companion.route', requestId: 'route-1', prompt, ...selection })
    s.jobs[0]!.resolve(reply(JSON.stringify({ kind: 'control', action: 'battle', shape: 'open', lifetime, question: null })))
    const route = (await routing) as CompanionRouteResult
    expect(route.kind).toBe('control')
    if (route.kind !== 'control') throw new Error('Expected control route')
    await s.dispatch({ type: 'agent.companion.control.start', requestId: 'start-1', ticketId: route.ticketId })
    expect(s.startControl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'battle',
        shape: 'open',
        goal: prompt,
        lifetime,
        model: 'small',
        conversationId: 'c1',
      }),
      false,
      undefined
    )
    await expect(s.dispatch({ type: 'agent.companion.control.start', requestId: 'start-2', ticketId: route.ticketId })).rejects.toMatchObject({ code: 'STALE_CARD' })
    expect(s.startControl).toHaveBeenCalledTimes(1)
  } finally {
    await s.close()
  }
})

test.each(['newer route', 'manual takeover', 'load', 'memory clear'] as const)('%s invalidates a pending route even if the model ignores abort', async (reason) => {
  const s = await setup()
  try {
    const rejected = expect(s.route('old')).rejects.toBeDefined()
    if (reason === 'newer route') {
      const newer = s.route('new')
      s.jobs[1]!.resolve(reply('{"kind":"chat","action":null,"shape":"single","lifetime":"goal","question":null}'))
      await expect(newer).resolves.toMatchObject({ kind: 'chat' })
    } else if (reason === 'manual takeover') s.host.invalidateControl()
    else if (reason === 'load') s.changeEpoch()
    else await s.changeMemory('clear')
    s.jobs[0]!.resolve(reply(controlReply))
    await rejected
    await expect(s.dispatch({ type: 'agent.companion.control.start', requestId: 'start', ticketId: 'ticket-old' })).rejects.toMatchObject({ code: 'STALE_CARD' })
    expect(s.startControl).not.toHaveBeenCalled()
  } finally {
    await s.close()
  }
})

test('chat carries real battle context through an independent model conversation', async () => {
  const s = await setup()
  try {
    const routing = s.route('route')
    s.jobs[0]!.resolve(reply('{"kind":"chat","action":null,"shape":"single","lifetime":"goal","question":null}'))
    await routing
    await s.chat('hello')
    const chat = s.jobs[1]!
    expect(chat.options.purpose).toBe('chat')
    expect(chat.options.conversationKey).not.toBe(s.jobs[0]!.options.conversationKey)
    expect(JSON.parse(chat.messages.at(-1)!.content!)).toMatchObject({ battle: s.battle })
    chat.resolve(reply('hello'))
    await flush()
    expect((await s.events()).events).toContainEqual(expect.objectContaining({ kind: 'completed', text: 'hello' }))
  } finally {
    await s.close()
  }
})

test.each(['clear', 'recording'] as const)('remote %s suppresses stale chat deltas, completion and future history', async (action) => {
  const s = await setup()
  try {
    await s.chat('old message')
    const old = s.jobs[0]!
    await s.changeMemory(action)
    // No intervening host dispatch: the streaming callback must detect the version itself.
    old.options.onDelta?.('obsolete reply')
    expect(old.options.signal.aborted).toBe(true)
    old.resolve(reply('obsolete reply'))
    await flush()
    const events = (await s.events()).events
    expect(events).toContainEqual(expect.objectContaining({ kind: 'cancelled', requestId: 'old message' }))
    expect(events.filter((event) => event.kind === 'completed' || event.kind === 'delta')).toEqual([])
    await s.chat('fresh message')
    const current = s.jobs[1]!
    const context = JSON.parse(current.messages.at(-1)!.content!)
    expect(context.recentHistory).toEqual([{ role: 'user', content: 'fresh message' }])
    current.resolve(reply('fresh reply'))
    await flush()
    expect((await s.events()).events).toContainEqual(expect.objectContaining({ kind: 'completed', text: 'fresh reply' }))
  } finally {
    await s.close()
  }
})
import { experienceBatch, hpResult } from '@/__tests__/lib/game-agent/companion/experience-fixtures'

test('chat supplies HP conditions and counterexamples, then renders the cited system summary instead of model claims', async () => {
  const s = await setup()
  try {
    s.memory.acceptCommittedRecording(experienceBatch([hpResult(0), hpResult(1, { hpAfter: 100 })]))
    await s.chat('experience-chat')
    const job = s.jobs[0]!
    const payload = JSON.parse(job.messages[1].content)
    expect(payload).toMatchObject({
      experienceCoverage: 'retained_observations',
      experiences: [expect.objectContaining({ status: 'has_counterexamples', counterexampleResults: 1 })],
    })
    const experience = payload.experiences[0]
    job.options.onDelta?.('{"text":"必定造成9999伤害",')
    expect((await s.events()).events.some((event) => event.kind === 'delta')).toBe(false)
    job.resolve(
      reply(JSON.stringify({ text: '必定造成9999伤害', blocks: [{ kind: 'experience_ref', experienceId: experience.experienceId, summary: '伪造结论', status: 'confirmed' }] }))
    )
    await flush()
    expect((await s.events()).events).toContainEqual(expect.objectContaining({ kind: 'completed', text: experience.summary }))
  } finally {
    await s.close()
  }
})

test('chat cannot cite an experience discarded by context budgeting', async () => {
  const s = await setup()
  try {
    s.memory.acceptCommittedRecording(experienceBatch([hpResult(0)]))
    const ref = s.memory.queryExperiences(battleFrame().stamp.scope).experiences[0].experienceId
    s.battle.lastActionReason = 'x'.repeat(9700)
    await s.chat('large-chat')
    const job = s.jobs[0]!
    expect(job).toBeDefined()
    expect(JSON.parse(job.messages[1].content).experiences).toEqual([])
    expect(job.messages.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(11_900)
    job.resolve(reply(JSON.stringify({ text: '', blocks: [{ kind: 'experience_ref', experienceId: ref }] })))
    await flush()
    expect((await s.events()).events).toContainEqual(expect.objectContaining({ kind: 'completed', text: '我这边没有足够的已验证经历可引用。' }))
  } finally {
    await s.close()
  }
})
