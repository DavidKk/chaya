import { engineAcceptsSensitive, engineGroup, engineSourceTag, engineStateFileBody, mergeEngineState, normalizeAgentEntries, normalizeEngineOrder } from '@/lib/translate/engines'

describe('translate engines', () => {
  it('groups agent entries apart from platforms; only agents receive sensitive text', () => {
    expect(engineGroup('agent:x')).toBe('agent')
    expect(engineGroup('google')).toBe('platform')
    expect(engineAcceptsSensitive('agent:x')).toBe(true)
    expect(engineAcceptsSensitive('bing')).toBe(false)
  })

  it('drops the old built-in Ollama engine from legacy files', () => {
    const state = mergeEngineState({ ollama: true, bing: false, google: true, order: ['google', 'ollama', 'bing'] })
    expect(state.switches).toEqual({ bing: false, google: true })
    expect(state.agents).toEqual([])
    expect(state.order).toEqual(['google', 'bing'])
    expect(state.enabled).toEqual(['google'])
  })

  it('normalizes agent entries and appends new ones to the order', () => {
    const agents = normalizeAgentEntries([
      { id: 'a1', profileId: 'p1', model: 'qwen' },
      { id: 'a1', profileId: 'dup' },
      { id: 'bad id', profileId: 'p2' },
      { id: 'a2', profileId: '' },
      { id: 'a3', profileId: 'p3', enabled: false },
    ])
    expect(agents).toEqual([
      { id: 'a1', profileId: 'p1', model: 'qwen', enabled: true },
      { id: 'a3', profileId: 'p3', model: '', enabled: false },
    ])
    expect(normalizeEngineOrder(['agent:a3', 'agent:gone', 'bing'], agents)).toEqual(['agent:a3', 'bing', 'google', 'agent:a1'])
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
})
