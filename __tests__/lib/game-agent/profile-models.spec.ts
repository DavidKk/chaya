import { resolveAgentModelsByProfile, resolveAgentProfileModels } from '@/lib/game-agent/profile-models'

describe('resolveAgentProfileModels', () => {
  const catalog = [
    { name: 'codex/gpt-a', label: 'A' },
    { name: 'codex/gpt-b', label: 'B' },
    { name: 'codex/gpt-c', label: 'C' },
  ]

  it('returns the full catalog when enabledModels is unset', () => {
    expect(resolveAgentProfileModels({ defaultModel: 'codex/gpt-b' }, catalog)).toEqual({
      models: catalog,
      defaultModel: 'codex/gpt-b',
    })
  })

  it('filters to the enabled allowlist and keeps labels from the catalog', () => {
    expect(resolveAgentProfileModels({ defaultModel: 'codex/gpt-c', enabledModels: ['codex/gpt-c', 'codex/gpt-a'] }, catalog)).toEqual({
      models: [
        { name: 'codex/gpt-c', label: 'C' },
        { name: 'codex/gpt-a', label: 'A' },
      ],
      defaultModel: 'codex/gpt-c',
    })
  })

  it('still exposes enabled models when the catalog cache is empty', () => {
    expect(resolveAgentProfileModels({ defaultModel: 'codex/gpt-a', enabledModels: ['codex/gpt-a', 'codex/gpt-b'] }, [])).toEqual({
      models: [{ name: 'codex/gpt-a' }, { name: 'codex/gpt-b' }],
      defaultModel: 'codex/gpt-a',
    })
  })

  it('falls back to the default model alone when nothing else is known', () => {
    expect(resolveAgentProfileModels({ defaultModel: 'only-one' }, [])).toEqual({
      models: [{ name: 'only-one' }],
      defaultModel: 'only-one',
    })
  })

  it('builds a sync payload from allowlists even without disk cache', () => {
    expect(
      resolveAgentModelsByProfile(
        [
          { id: 'magpie', defaultModel: 'a', enabledModels: ['a', 'b'] },
          { id: 'empty', defaultModel: '' },
        ],
        {}
      )
    ).toEqual({
      magpie: [{ name: 'a' }, { name: 'b' }],
    })
  })
})
