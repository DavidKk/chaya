const mockLoadedMapEntries = jest.fn<ReadonlyArray<{ id: number; data: unknown }>, []>(() => [])
const mockRunCommonEvent = jest.fn()
const mockRunMapEvent = jest.fn()
let mockPlayerPosition = { mapId: 1, x: 0, y: 0, direction: 2 }
const mockTeleportPlayer = jest.fn(async (target: { mapId: number; x: number; y: number; direction?: number }) => {
  mockPlayerPosition = { mapId: target.mapId, x: target.x, y: target.y, direction: target.direction ?? 2 }
  return mockPlayerPosition
})

jest.mock('@/plugins/src/cheat/session/live-events', () => ({
  isOnMapScene: () => true,
  loadedMapEntries: () => mockLoadedMapEntries(),
  runCommonEventOnMap: (...args: unknown[]) => mockRunCommonEvent(...args),
}))
jest.mock('@/plugins/src/cheat/session/live-map', () => ({
  transferPending: () => false,
  playerSpot: () => mockPlayerPosition,
  teleportPlayer: (target: { mapId: number; x: number; y: number; direction?: number }) => mockTeleportPlayer(target),
  setSelfSwitch: jest.fn(),
  runMapEvent: (input: unknown) => mockRunMapEvent(input),
}))

import type { MapOperationMessage, MapOperationValue } from '@/lib/runtime/game-link-protocol'
import { handleMapOperationMessage } from '@/plugins/src/cheat/session/map-operations/runtime'

describe('map operation runtime', () => {
  const switches = new Map<number, boolean>()
  const variables = new Map<number, number>()

  beforeEach(() => {
    switches.clear()
    variables.clear()
    mockPlayerPosition = { mapId: 1, x: 0, y: 0, direction: 2 }
    mockTeleportPlayer.mockClear()
    mockRunCommonEvent.mockClear()
    mockRunMapEvent.mockClear()
    mockLoadedMapEntries.mockReturnValue([])
    Object.assign(globalThis, {
      $dataCommonEvents: [null],
      $gameMessage: { isBusy: () => false },
      $gameSwitches: { value: (id: number) => switches.get(id), setValue: (id: number, value: boolean) => switches.set(id, value) },
      $gameVariables: { value: (id: number) => variables.get(id), setValue: (id: number, value: number) => variables.set(id, value) },
    })
  })

  const request = (requestId: string, changes: MapOperationValue[]): MapOperationMessage => ({
    type: 'map.operation.start',
    requestId,
    gameId: 'g1',
    generation: 1,
    deadlineAt: Date.now() + 60_000,
    summary: 'batch',
    items: changes.map((change, index) => ({ label: `item-${index + 1}`, changes: [change] })),
  })

  async function run(message: MapOperationMessage) {
    const replies: MapOperationMessage[] = []
    expect(handleMapOperationMessage(message, (reply) => replies.push(reply))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return replies[0]
  }

  it('executes a batch once and exposes the shared undo step', async () => {
    switches.set(1, false)
    variables.set(2, 3)
    const message = request('batch-runtime', [
      { kind: 'switch', id: 1, value: true },
      { kind: 'variable', id: 2, value: 9 },
    ])
    await expect(run(message)).resolves.toMatchObject({ type: 'map.operation.reply', ok: true, status: { completed: 2 }, undo: { id: 'batch-runtime' } })
    expect(switches.get(1)).toBe(true)
    expect(variables.get(2)).toBe(9)
    await run(message)
    expect(switches.get(1)).toBe(true)
  })

  it('detects an undo conflict before forcing restoration', async () => {
    switches.set(3, false)
    await run(request('conflict-batch', [{ kind: 'switch', id: 3, value: true }]))
    switches.set(3, false)
    const base = { requestId: 'conflict-inspect', gameId: 'g1', generation: 1, deadlineAt: Date.now() + 60_000, stepId: 'conflict-batch' }
    await expect(run({ type: 'map.operation.undo', ...base })).resolves.toMatchObject({ ok: true, status: { state: 'failed' }, conflicts: { length: 1 } })
    switches.set(3, true)
    await expect(run({ type: 'map.operation.undo', ...base, requestId: 'conflict-force', force: true })).resolves.toMatchObject({ ok: true, status: { state: 'completed' } })
    expect(switches.get(3)).toBe(false)
  })

  it('rejects a switch that would start an unsafe autorun page', async () => {
    switches.set(4, false)
    mockLoadedMapEntries.mockReturnValue([
      {
        id: 1,
        data: {
          events: [
            null,
            {
              pages: [
                {
                  trigger: 3,
                  conditions: { switch1Valid: true, switch1Id: 4 },
                  list: [{ code: 355, indent: 0, parameters: ['while (true) {}'] }],
                },
              ],
            },
          ],
        },
      },
    ])

    await expect(run(request('unsafe-autorun', [{ kind: 'switch', id: 4, value: true }]))).resolves.toMatchObject({
      ok: true,
      status: { state: 'failed', completed: 0, failed: 1, error: expect.stringContaining('脚本指令') },
    })
    expect(switches.get(4)).toBe(false)
  })

  it('allows disarming an unsafe autorun condition', async () => {
    switches.set(4, true)
    mockLoadedMapEntries.mockReturnValue([
      {
        id: 1,
        data: {
          events: [
            null,
            {
              pages: [
                {
                  trigger: 3,
                  conditions: { switch1Valid: true, switch1Id: 4 },
                  list: [{ code: 355, indent: 0, parameters: ['opaque()'] }],
                },
              ],
            },
          ],
        },
      },
    ])

    await expect(run(request('disarm-autorun', [{ kind: 'switch', id: 4, value: false }]))).resolves.toMatchObject({
      ok: true,
      status: { state: 'completed', completed: 1, failed: 0 },
    })
    expect(switches.get(4)).toBe(false)
  })

  it('stops remaining writes once a current-map autorun can start', async () => {
    switches.set(5, false)
    switches.set(6, false)
    mockLoadedMapEntries.mockReturnValue([
      {
        id: 1,
        data: {
          events: [
            null,
            {
              pages: [
                {
                  trigger: 3,
                  conditions: { switch1Valid: true, switch1Id: 5 },
                  list: [{ code: 0, indent: 0, parameters: [] }],
                },
              ],
            },
          ],
        },
      },
    ])

    await expect(
      run(
        request('start-autorun', [
          { kind: 'switch', id: 5, value: true },
          { kind: 'switch', id: 6, value: true },
        ])
      )
    ).resolves.toMatchObject({ ok: true, status: { state: 'completed', completed: 1, failed: 0 } })
    expect(switches.get(5)).toBe(true)
    expect(switches.get(6)).toBe(false)
  })

  it('records and restores player position through the same undo stack', async () => {
    await expect(run(request('teleport', [{ kind: 'position', mapId: 3, x: 7, y: 8, direction: 6, near: true }]))).resolves.toMatchObject({
      ok: true,
      status: { state: 'completed', completed: 1 },
      undo: { id: 'teleport' },
    })
    expect(mockPlayerPosition).toEqual({ mapId: 3, x: 7, y: 8, direction: 6 })

    await expect(
      run({ type: 'map.operation.undo', requestId: 'undo-teleport', gameId: 'g1', generation: 1, deadlineAt: Date.now() + 60_000, stepId: 'teleport' })
    ).resolves.toMatchObject({ ok: true, status: { state: 'completed', completed: 1 } })
    expect(mockPlayerPosition).toEqual({ mapId: 1, x: 0, y: 0, direction: 2 })
  })

  it('runs explicit common and map events through the shared operation coordinator', async () => {
    await expect(
      run({
        type: 'map.operation.start',
        requestId: 'event-actions',
        gameId: 'g1',
        generation: 1,
        deadlineAt: Date.now() + 60_000,
        summary: 'events',
        items: [
          { label: 'common', action: { kind: 'commonEvent', id: 2, from: 3 } },
          { label: 'map', action: { kind: 'mapEvent', mapId: 1, eventId: 4, page: 0, from: 2 } },
        ],
      })
    ).resolves.toMatchObject({ ok: true, status: { state: 'completed', completed: 2 } })
    expect(mockRunCommonEvent).toHaveBeenCalledWith(2, 3)
    expect(mockRunMapEvent).toHaveBeenCalledWith({ kind: 'mapEvent', mapId: 1, eventId: 4, page: 0, from: 2 })
  })
})
