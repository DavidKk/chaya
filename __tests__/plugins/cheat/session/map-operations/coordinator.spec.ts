import { MapOperationCoordinator } from '@/plugins/src/cheat/session/map-operations/coordinator'

const identity = (requestId: string) => ({ requestId, gameId: 'g1', generation: 1, deadlineAt: Date.now() + 60_000 })

describe('map operation coordinator', () => {
  it('releases its lock after failure and deduplicates request ids', async () => {
    const coordinator = new MapOperationCoordinator()
    const execute = jest.fn(async () => ({ state: 'completed' as const, value: null }))
    const first = coordinator.run(identity('one'), 'single', [1], execute)
    await expect(coordinator.run(identity('two'), 'single', [2], execute)).rejects.toThrow('已有地图操作')
    await expect(first).resolves.toMatchObject({ state: 'completed' })
    await coordinator.run(identity('one'), 'single', [1], execute)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(coordinator.status()).toBeNull()
  })

  it('stops a batch on automatic start or unknown result', async () => {
    const coordinator = new MapOperationCoordinator()
    const automatic = jest.fn(async (_item: number, index: number) => ({ state: 'completed' as const, value: null, startedAutomatic: index === 1 }))
    await expect(coordinator.run(identity('auto'), 'batch', [1, 2, 3], automatic)).resolves.toMatchObject({ completed: 2 })
    expect(automatic).toHaveBeenCalledTimes(2)
    const unknown = jest.fn(async (_item: number, index: number) =>
      index === 1 ? ({ state: 'unknown' as const, error: 'lost' } as const) : ({ state: 'completed' as const, value: null } as const)
    )
    await expect(coordinator.run(identity('unknown'), 'batch', [1, 2, 3], unknown)).resolves.toMatchObject({ state: 'unknown', completed: 1, failed: 1 })
    expect(unknown).toHaveBeenCalledTimes(2)
  })

  it('keeps only ten undo steps and rejects batches over fifty', async () => {
    const coordinator = new MapOperationCoordinator()
    for (let index = 0; index < 11; index++) coordinator.recordUndo({ id: String(index), summary: '', values: [{ key: 'x', before: 0, after: 1 }] })
    expect(coordinator.undoStack().map((step) => step.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    await expect(coordinator.run(identity('large'), 'batch', Array.from({ length: 51 }), async () => ({ state: 'completed', value: null }))).rejects.toThrow('最多 50')
  })

  it('requires conflict confirmation and removes values only after verified restoration', async () => {
    const coordinator = new MapOperationCoordinator()
    const values = new Map<string, unknown>([
      ['switch:1', false],
      ['variable:2', 9],
    ])
    coordinator.recordUndo({
      id: 'step',
      summary: 'two values',
      values: [
        { key: 'switch:1', before: false, after: true },
        { key: 'variable:2', before: 1, after: 2 },
      ],
    })
    const adapter = { read: (key: string) => values.get(key), write: (key: string, value: unknown) => void values.set(key, value) }
    await expect(coordinator.undo(identity('inspect'), adapter)).resolves.toMatchObject({ status: { state: 'failed' }, conflicts: { length: 2 }, remaining: 2 })
    await expect(coordinator.undo(identity('restore'), adapter, { force: true })).resolves.toMatchObject({ status: { state: 'completed', completed: 2 }, remaining: 0 })
    expect(values).toEqual(
      new Map<string, unknown>([
        ['switch:1', false],
        ['variable:2', 1],
      ])
    )
    expect(coordinator.latestUndo()).toBeNull()
  })

  it('retains failed undo values so the user can retry', async () => {
    const coordinator = new MapOperationCoordinator()
    coordinator.recordUndo({
      id: 'step',
      summary: 'partial',
      values: [
        { key: 'a', before: 0, after: 1 },
        { key: 'b', before: 0, after: 1 },
      ],
    })
    const values = new Map<string, unknown>([
      ['a', 1],
      ['b', 1],
    ])
    const adapter = {
      read: (key: string) => values.get(key),
      write: (key: string, value: unknown) => {
        if (key === 'a') throw new Error('locked')
        values.set(key, value)
      },
    }
    await expect(coordinator.undo(identity('partial'), adapter)).resolves.toMatchObject({ status: { state: 'failed', completed: 1, failed: 1 }, remaining: 1 })
    expect(coordinator.latestUndo()?.values.map((value) => value.key)).toEqual(['a'])
  })

  it('restores trigger values before deferring an unsafe player position', async () => {
    const coordinator = new MapOperationCoordinator()
    coordinator.recordUndo({
      id: 'escape-autorun',
      summary: 'trigger and position',
      values: [
        { key: 'switch:1', before: false, after: true },
        { key: 'playerPosition', before: { mapId: 1, x: 1, y: 1 }, after: { mapId: 2, x: 2, y: 2 } },
      ],
    })
    const values = new Map<string, unknown>([
      ['switch:1', true],
      ['playerPosition', { mapId: 2, x: 2, y: 2 }],
    ])
    const writes: string[] = []
    const adapter = {
      read: (key: string) => values.get(key),
      write: (key: string, value: unknown) => {
        writes.push(key)
        if (key === 'playerPosition') throw new Error('dialogue busy')
        values.set(key, value)
      },
    }

    await expect(coordinator.undo(identity('escape'), adapter)).resolves.toMatchObject({ status: { state: 'failed', completed: 1, failed: 1 }, remaining: 1 })
    expect(writes).toEqual(['switch:1', 'playerPosition'])
    expect(values.get('switch:1')).toBe(false)
    expect(coordinator.latestUndo()?.values).toEqual([expect.objectContaining({ key: 'playerPosition' })])
  })
})
