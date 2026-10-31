import { addTokenUsage, sanitizeAgentActivity, sanitizeAgentText } from '@/lib/game-agent/activity'

describe('agent activity', () => {
  it('redacts secret fields, bearer values, and local user paths before persistence', () => {
    expect(
      sanitizeAgentActivity({
        authorization: 'Bearer hidden',
        nested: { apiKey: 'private', note: 'token=abc123 at /Users/alice/project/game.json and /var/folders/cache/result.json' },
      })
    ).toEqual({ authorization: '[REDACTED]', nested: { apiKey: '[REDACTED]', note: 'token=[REDACTED] at <local-path> and <local-path>' } })
    expect(sanitizeAgentText('Bearer abc.def')).toBe('Bearer [REDACTED]')
  })

  it('accumulates provider token usage without inventing missing fields', () => {
    expect(addTokenUsage({ input: 10, total: 12 }, { output: 5, total: 5 })).toEqual({ input: 10, output: 5, total: 17 })
    expect(addTokenUsage(undefined, undefined)).toBeUndefined()
  })

  it('preserves numeric first-token timing without allowing credentials through the metric name', () => {
    expect(sanitizeAgentActivity({ metrics: { firstTokenMs: 125.5 }, token: 123 })).toEqual({
      metrics: { firstTokenMs: 125.5 },
      token: '[REDACTED]',
    })
    for (const firstTokenMs of ['Bearer private', { token: 'private' }, NaN, Infinity, -1]) {
      expect(sanitizeAgentActivity({ firstTokenMs })).toEqual({ firstTokenMs: '[REDACTED]' })
    }
  })
})
