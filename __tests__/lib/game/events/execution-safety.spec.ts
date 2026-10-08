import { analyzeExecutionSafety, type EventCommand } from '@/lib/game/events'

const command = (code: number, parameters: unknown[] = []): EventCommand => ({ code, indent: 0, parameters })

describe('event execution safety', () => {
  it.each([
    [355, 'script'],
    [356, 'plugin-command'],
    [357, 'plugin-command'],
  ])('rejects opaque command %s', (code, expected) => {
    expect(analyzeExecutionSafety([command(code)], () => null)).toMatchObject({ safe: false, issue: expected })
  })

  it('rejects unconditional loops and allows a loop with break', () => {
    expect(analyzeExecutionSafety([command(112), command(413)], () => null)).toMatchObject({ safe: false, issue: 'unbounded-loop' })
    expect(analyzeExecutionSafety([command(112), command(113), command(413)], () => null)).toEqual({ safe: true, visited: 0 })
  })

  it('rejects recursive and over-deep common event calls', () => {
    const common = new Map<number, EventCommand[]>([
      [1, [command(117, [2])]],
      [2, [command(117, [1])]],
    ])
    expect(analyzeExecutionSafety([command(117, [1])], (id) => common.get(id) ?? null)).toMatchObject({ safe: false, issue: 'recursive-call' })
    const chain = new Map<number, EventCommand[]>()
    for (let id = 1; id <= 10; id++) chain.set(id, [command(117, [id + 1])])
    expect(analyzeExecutionSafety([command(117, [1])], (id) => chain.get(id) ?? null, { maxDepth: 3 })).toMatchObject({ safe: false, issue: 'depth' })
  })
})
