import { planSentenceTranslation } from '@/lib/translate/sentence-plan'
import { agentJaToZh, type AgentTranslateOptions } from '@/services/translate/agent-translate'
import type { startCacheLane } from '@/services/translate/scheduler/cache-lane'
import type { SeedInventoryBundle } from '@/services/translate/scheduler/seed-prepare'
import { createScheduledSeedSession } from '@/services/translate/scheduler/seed-session'

let mockLane: Parameters<typeof startCacheLane>[0]
const mockTrace = jest.fn()
const mockAgent = { id: 'a', profileId: 'a', model: 'qwen', enabled: true, concurrencyLimit: 1, maxConcurrentChars: 3000 }
jest.mock('@/services/translate/engine-switches', () => ({
  getTranslateEngineSwitches: () => ({ enabled: ['agent:a'], agents: [mockAgent] }),
}))
jest.mock('@/services/translate/scheduler/cache-lane', () => ({
  startCacheLane: (options: Parameters<typeof startCacheLane>[0]) => {
    mockLane = options
    return { close: async () => {}, wake: () => {}, setLease: () => {}, stampAdvance: () => {} }
  },
}))
jest.mock('@/services/translate/scheduler/seed-inventory', () => ({ seedFileStamp: () => 'seed' }))
jest.mock('@/services/translate/game-records', () => ({ gameTranslationFiles: () => ({ stamp: 'game' }) }))
jest.mock('@/services/translate/game-cache-context', () => ({ getGameCacheContext: () => ({ authorityVersion: 'authority' }) }))
jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: () => ({ version: () => 'v1', current: () => true, close: () => {}, flushBackfill: () => ({ sharedOnly: false }) }),
}))
jest.mock('@/services/translate/sensitive-text', () => ({ isSensitiveForCloud: () => false }))
jest.mock('@/services/translate/live-translate', () => ({
  liveTranslateTexts: async (texts: string[], options: { local: AgentTranslateOptions; onTrace: (message: string) => void }) => ({
    items: [
      {
        src: texts[0],
        zh: await agentJaToZh(texts[0], { profileId: 'a', model: 'qwen' }, { ...options.local, maxChars: 3000, concurrency: 1, onTrace: options.onTrace }),
        engine: 'agent:a',
      },
    ],
  }),
}))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: () => '' }))
jest.mock('@/services/game-agent/model-cache', () => ({ loadAgentModelCache: () => ({}) }))
jest.mock('@/services/game-agent/settings', () => {
  const profile = { id: 'a', provider: 'ollama', endpoint: 'http://agent.local:11434', defaultModel: 'qwen' }
  return { loadGameAgentSettings: () => ({}), profileById: () => profile, ollamaProfiles: () => [profile] }
})

const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

it('fills a 3000-character Agent request across cache shards and sends only the real tail partially filled', async () => {
  jest.useFakeTimers()
  const texts = Array.from({ length: 400 }, (_, id) => `あいうえお${String(id).padStart(4, '0')}`)
  const inventory: SeedInventoryBundle = {
    pending: texts,
    stamp: 'seed',
    progress: {
      contentRoot: '/test',
      hasSeed: true,
      total: 400,
      done: 0,
      missing: 400,
      needCount: 400,
      skipCount: 0,
      needChars: 3600,
      skipChars: 0,
      missingChars: 3600,
      doneChars: 0,
      lines: 400,
      batchSize: 4,
      batchesLeft: 100,
    },
  }
  const session = createScheduledSeedSession('/test', mockTrace, { inventory })
  let releaseFirst!: () => void
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let calls = 0
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (++calls === 1) await firstResponse
    const content = JSON.parse(String(init?.body)).messages.at(-1).content as string
    const lines = content.split('\n').filter((line) => /^\[\d+\]/.test(line))
    return new Response(JSON.stringify({ message: { content: lines.map((_, i) => `[${i + 1}] 翻译${i}`).join('\n') } }))
  })
  try {
    const first = session.fill({ limit: 4, onTrace: mockTrace })
    await tick()
    // Misses arrive in the same 32-item shards used by the worker, on different turns.
    for (let shard = 0; shard < 13; shard++) {
      const tasks = mockLane.next('lease')!
      expect(tasks.length).toBeGreaterThan(0)
      for (const task of tasks) {
        mockLane.onResult(
          {
            id: task.id,
            src: task.src,
            stamp: 'game',
            authorityVersion: 'authority',
            elapsedMs: 1,
            plan: { ...planSentenceTranslation(task.src, []), corpusVersion: 'v1' },
          },
          shard,
          'lease'
        )
        await tick()
      }
      mockLane.onBatchDone(shard, 'lease', 1)
      await jest.advanceTimersByTimeAsync(0)
      if (shard < 10) expect(fetchMock).not.toHaveBeenCalled()
    }
    await jest.advanceTimersByTimeAsync(250)
    releaseFirst()
    await jest.advanceTimersByTimeAsync(0)
    const requests = mockTrace.mock.calls.map(([message]) => message).filter((message) => message.startsWith('Agent request submitted:'))
    expect(requests).toEqual(['Agent request submitted: items=333, sourceChars=2997', 'Agent request submitted: items=67, sourceChars=603'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((await first).translated).toBeGreaterThan(0)
  } finally {
    releaseFirst()
    session.pause()
    await jest.advanceTimersByTimeAsync(5000)
    await session.close()
    fetchMock.mockRestore()
    jest.useRealTimers()
  }
})
