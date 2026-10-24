import {
  assignMissingEngineEntryIds,
  builtinEngineByEntryId,
  engineAcceptsSensitive,
  engineGroup,
  engineRouteId,
  engineSourceTag,
  engineStateFileBody,
  isEngineEntryId,
  isTranslateEngineId,
  mapTranslationBatch,
  mergeEngineState,
  normalizeAgentEntries,
  normalizeEngineOrder,
  resolveEngineCapacitySettings,
  resolveEngineRouteId,
  translationFallbackOrder,
} from '@/lib/translate/engines'

describe('translate engines', () => {
  it('groups agent entries apart from platforms; only agents receive sensitive text', () => {
    expect(engineGroup('agent:x')).toBe('agent')
    expect(engineGroup('google')).toBe('platform')
    expect(engineGroup('apple')).toBe('system')
    expect(engineGroup('bergamot')).toBe('system')
    expect(engineAcceptsSensitive('agent:x')).toBe(true)
    expect(engineAcceptsSensitive('bing')).toBe(false)
    expect(isTranslateEngineId('bing')).toBe(true)
    expect(isTranslateEngineId('agent:a1')).toBe(true)
    expect(isTranslateEngineId('agent:bad id')).toBe(false)
    expect(isTranslateEngineId('nope')).toBe(false)
    expect(isEngineEntryId('m8k2ab1x9q')).toBe(true)
    expect(isEngineEntryId('bing')).toBe(true)
    expect(isEngineEntryId('agent:a1')).toBe(false)
  })

  it('assigns persistent entry ids for builtin engines and resolves route ids', () => {
    const state = mergeEngineState({ bing: true, configs: { bing: { id: 'm8k2ab1x9q' } } })
    expect(state.configs.bing.id).toBe('m8k2ab1x9q')
    expect(state.configs.google.id).toBe('')
    const assigned = assignMissingEngineEntryIds(state.configs)
    expect(assigned.changed).toBe(true)
    expect(assigned.configs.bing.id).toBe('m8k2ab1x9q')
    expect(isEngineEntryId(assigned.configs.google.id)).toBe(true)
    expect(assigned.configs.google.id).not.toBe('google')
    expect(engineRouteId('bing', assigned.configs)).toBe('m8k2ab1x9q')
    expect(resolveEngineRouteId('m8k2ab1x9q', assigned.configs)).toBe('bing')
    expect(resolveEngineRouteId('bing', assigned.configs)).toBe('bing')
    expect(builtinEngineByEntryId(assigned.configs, 'm8k2ab1x9q')).toBe('bing')
    expect(resolveEngineRouteId('agent:a1', assigned.configs, [{ id: 'a1', profileId: 'p', model: '', enabled: true }])).toBe('agent:a1')
    expect(engineRouteId('agent:a1')).toBe('a1')
  })

  it('drops the old built-in Ollama engine from legacy files', () => {
    const state = mergeEngineState({ ollama: true, bing: false, google: true, order: ['google', 'ollama', 'bing'] })
    expect(state.switches).toEqual({ bing: false, google: true, apple: false, bergamot: false })
    expect(state.agents).toEqual([])
    expect(state.order).toEqual(['google', 'bing', 'apple', 'bergamot'])
    expect(state.enabled).toEqual(['google'])
  })

  it('normalizes agent entries and appends new ones to the order', () => {
    const agents = normalizeAgentEntries([
      { id: 'a1', profileId: 'p1', model: 'qwen', allowConcurrency: true, concurrencyLimit: 8, maxConcurrentChars: 5000 },
      { id: 'a1', profileId: 'dup' },
      { id: 'bad id', profileId: 'p2' },
      { id: 'a2', profileId: '' },
      { id: 'a3', profileId: 'p3', enabled: false },
      { id: 'a4', profileId: 'p4', maxConcurrentChars: 40000 },
    ])
    expect(agents).toEqual([
      { id: 'a1', profileId: 'p1', model: 'qwen', enabled: true, allowConcurrency: true, concurrencyLimit: 8, maxConcurrentChars: 5000 },
      { id: 'a3', profileId: 'p3', model: '', enabled: false },
      { id: 'a4', profileId: 'p4', model: '', enabled: true, maxConcurrentChars: 40000 },
    ])
    expect(normalizeEngineOrder(['agent:a3', 'agent:gone', 'bing'], agents)).toEqual(['agent:a3', 'bing', 'google', 'apple', 'bergamot', 'agent:a1', 'agent:a4'])
    expect(resolveEngineCapacitySettings('bing', { bing: { allowConcurrency: false, concurrencyLimit: 1, maxConcurrentChars: 1500 } })).toEqual({
      allowConcurrency: false,
      concurrencyLimit: 1,
      maxConcurrentChars: 1500,
    })
    expect(resolveEngineCapacitySettings('agent:a1', undefined, agents)).toEqual({
      allowConcurrency: true,
      concurrencyLimit: 8,
      maxConcurrentChars: 5000,
    })
  })

  it('manages engine configs for builtin engines and synchronizes enabled state', () => {
    const state = mergeEngineState(
      { bing: true, google: false },
      {
        configs: {
          bing: { allowConcurrency: false, concurrencyLimit: 1, maxConcurrentChars: 1500 },
          google: { enabled: true, concurrencyLimit: 10 },
        },
      }
    )
    expect(state.switches.google).toBe(true)
    expect(state.configs.google.enabled).toBe(true)
    expect(state.configs.google.concurrencyLimit).toBe(10)
    expect(state.configs.bing.allowConcurrency).toBe(false)
    expect(state.configs.bing.concurrencyLimit).toBe(1)
    expect(state.configs.bing.maxConcurrentChars).toBe(1500)
    expect(state.configs.apple.concurrencyLimit).toBe(1)
    expect(state.configs.bing.id).toBe('')
  })

  it('replaces the agent list on write and drops removed keys from the order', () => {
    const raw = engineStateFileBody(
      mergeEngineState(null, {
        agents: [
          { id: 'a1', profileId: 'p1', model: '' },
          { id: 'a2', profileId: 'p2', model: 'm' },
        ],
        order: ['agent:a2', 'agent:a1'],
      })
    )
    const state = mergeEngineState(raw)
    expect(state.enabled).toEqual(['agent:a2', 'agent:a1', 'bing', 'google'])
    const removed = mergeEngineState(raw, { agents: [{ id: 'a1', profileId: 'p1' }] })
    expect(removed.order).not.toContain('agent:a2')
    expect(engineSourceTag('agent:a2', state.agents)).toBe('agent:p2')
    expect(engineSourceTag('google', state.agents)).toBe('google')
  })

  it('allows every engine to be off or removed', () => {
    const off = { bing: false, google: false }
    expect(mergeEngineState(off).enabled).toEqual([])
    expect(mergeEngineState(off, { agents: [{ id: 'a', profileId: 'p', enabled: false }] }).enabled).toEqual([])
    expect(mergeEngineState({ ...off, agents: [{ id: 'a', profileId: 'p' }] }, { agents: [] })).toMatchObject({ agents: [], enabled: [] })
    expect(mergeEngineState(off, { agents: [{ id: 'a', profileId: 'p' }] }).enabled).toEqual(['agent:a'])
  })

  it('keeps one entry per agent instance', () => {
    const state = mergeEngineState({
      agents: [
        { id: 'a1', profileId: 'p' },
        { id: 'a2', profileId: 'p' },
        { id: 'a3', profileId: 'q' },
      ],
    })
    expect(state.agents.map((a) => a.id)).toEqual(['a1', 'a3'])
  })

  it('preserves disabled engines when patching other switches or agent list', () => {
    const state = mergeEngineState({ bing: false, google: false })
    expect(state.switches).toEqual({ bing: false, google: false, apple: false, bergamot: false })

    const withApple = mergeEngineState(state, { switches: { apple: true } })
    expect(withApple.switches).toEqual({ bing: false, google: false, apple: true, bergamot: false })

    const withAgent = mergeEngineState(withApple, {
      agents: [{ id: 'a1', profileId: 'p1', model: '', enabled: true }],
    })
    expect(withAgent.switches).toEqual({ bing: false, google: false, apple: true, bergamot: false })
    expect(withAgent.enabled).toEqual(['agent:a1', 'apple'])
  })
})

describe('translation fallback order', () => {
  it.each([
    [
      ['agent:a', 'apple', 'google', 'agent:b', 'bing', 'bergamot'],
      ['agent:a', 'agent:b', 'google', 'bing', 'apple', 'bergamot'],
    ],
    [
      ['apple', 'google', 'agent:a', 'bergamot', 'agent:b', 'bing'],
      ['apple', 'bergamot', 'agent:a', 'agent:b', 'google', 'bing'],
    ],
    [
      ['google', 'apple', 'agent:a', 'bing', 'agent:b', 'bergamot'],
      ['google', 'bing', 'agent:a', 'agent:b', 'apple', 'bergamot'],
    ],
    [
      ['ollama', 'google', 'agent:a', 'apple'],
      ['ollama', 'apple', 'agent:a', 'google'],
    ],
  ] as const)('groups attempts starting from %j', (engines, expected) => {
    expect(translationFallbackOrder(engines)).toEqual(expected)
  })
  it('does not add disabled engines and never retries the same engine', () => {
    expect(translationFallbackOrder([])).toEqual([])
    expect(translationFallbackOrder(['google', 'google'])).toEqual(['google'])
  })
})

describe('concurrent translation batches', () => {
  it('limits concurrent texts to four and returns input order', async () => {
    const started: number[] = []
    const finish = new Map<number, (value: number) => void>()
    const pending = mapTranslationBatch([0, 1, 2, 3, 4], async (text) => {
      started.push(text)
      return new Promise<number>((resolve) => {
        finish.set(text, resolve)
      })
    })
    expect(started).toEqual([0, 1, 2, 3])
    finish.get(2)!(20)
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(started).toEqual([0, 1, 2, 3, 4])
    for (const text of [4, 3, 1, 0]) finish.get(text)!(text * 10)
    expect(await pending).toEqual([0, 10, 20, 30, 40])
  })
  it('drains in-flight work before rejecting so stores can close safely', async () => {
    let finish!: () => void
    let settled = false
    const pending = mapTranslationBatch([0, 1], async (text) => {
      if (text === 0) throw new Error('Cancelled')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return text
    })
    const checked = pending.catch((error) => {
      settled = true
      return error.message
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    expect(await checked).toBe('Cancelled')
  })
})
