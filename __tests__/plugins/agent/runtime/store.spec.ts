import type { AgentTask } from '@/lib/game-agent/runtime'
import { createGameAgentTaskStore, gameAgentStoreLimits } from '@/plugins/src/agent/runtime/store'

const task = (id: string, updatedAt = Date.now()): AgentTask => ({
  id,
  gameId: 'g1',
  conversationId: 'c1',
  capability: 'play',
  profileId: 'profile',
  model: 'model',
  state: 'completed',
  goal: id,
  createdAt: updatedAt,
  updatedAt,
  lastSeq: 0,
  events: [],
  messages: [],
  persistence: 'durable',
})

describe('game agent task store', () => {
  const values = new Map<string, string>()

  beforeAll(() => {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname: '/' } })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    })
  })

  beforeEach(() => values.clear())

  it('uses only v1 data and ignores corrupt storage', async () => {
    const store = createGameAgentTaskStore()
    localStorage.setItem('chaya.agent.tasks.v1:/', JSON.stringify({ version: 2, tasks: [task('old')] }))
    await expect(store.load()).resolves.toEqual([])
    localStorage.setItem('chaya.agent.tasks.v1:/', '{')
    await expect(store.load()).resolves.toEqual([])
  })

  it('keeps the newest twenty tasks and supports durable clear', async () => {
    const store = createGameAgentTaskStore()
    for (let index = 0; index < gameAgentStoreLimits.maxTasks + 2; index++) {
      await store.save(task(String(index), Date.now() + index), new AbortController().signal)
    }
    await expect(store.load()).resolves.toHaveLength(gameAgentStoreLimits.maxTasks)
    await store.remove?.('21', new AbortController().signal)
    expect((await store.load()).some((entry) => entry.id === '21')).toBe(false)
  })

  it('drops records older than seven days', async () => {
    const store = createGameAgentTaskStore()
    await store.save(task('stale', Date.now() - gameAgentStoreLimits.maxAgeMs - 1), new AbortController().signal)
    await expect(store.load()).resolves.toEqual([])
  })
})
