import { modelGameState } from '@/lib/game-agent/model-state'

test('drops events that do nothing and counts them as inactiveEvents', () => {
  const state = modelGameState({
    scene: 'Scene_Map',
    nearbyEvents: [
      { id: 1, name: 'Sparkle', interactive: true, look: 'object', animated: true, effects: ['gold'], x: 1, y: 2 },
      { id: 2, name: 'Torch', interactive: false, look: 'object', animated: true, effects: [], x: 3, y: 4 },
      { id: 3, name: 'Boris', interactive: true, look: 'character', animated: false, effects: ['text'], x: 5, y: 6 },
    ],
  }) as { nearbyEvents: Array<{ id: number; interactive?: boolean }>; inactiveEvents: number }
  expect(state.nearbyEvents.map((event) => event.id)).toEqual([1, 3])
  expect(state.nearbyEvents.every((event) => !('interactive' in event))).toBe(true)
  expect(state.inactiveEvents).toBe(1)
})

test('keeps look and animated facts for the model', () => {
  const state = modelGameState({
    scene: 'Scene_Map',
    nearbyEvents: [{ id: 7, name: 'EV007', interactive: true, look: 'object', animated: true, effects: ['text', 'gold'], hint: '枕套里有一些金币。' }],
  }) as { nearbyEvents: Array<Record<string, unknown>> }
  expect(state.nearbyEvents[0]).toMatchObject({ id: 7, look: 'object', animated: true, effects: ['text', 'gold'], hint: '枕套里有一些金币。' })
})

test('keeps semantic and real-route facts for target selection', () => {
  const state = modelGameState({
    scene: 'Scene_Map',
    nearbyEvents: [
      {
        id: 12,
        name: 'EV012',
        interactive: true,
        kind: 'object',
        transit: false,
        routeStatus: 'event_boundary',
        routeDistance: null,
        interactionPosition: null,
        eventBoundaryIds: [2],
      },
    ],
  }) as { nearbyEvents: Array<Record<string, unknown>> }
  expect(state.nearbyEvents[0]).toMatchObject({ kind: 'object', transit: false, routeStatus: 'event_boundary', eventBoundaryIds: [2] })
  expect(state.nearbyEvents[0]).toHaveProperty('routeDistance', null)
})

test('keeps empty equipment slots so unequipped weapons are visible', () => {
  const state = modelGameState({
    scene: 'Scene_Equip',
    nearbyEvents: [],
    party: [
      {
        name: 'Diana',
        equipment: [
          { slot: 0, id: null, name: null },
          { slot: 1, id: null, name: null },
          { slot: 2, id: 60, name: 'Hat0' },
        ],
      },
    ],
    inventory: { weapons: [{ id: 5, name: 'Thief dagger', count: 1 }], items: [], armors: [] },
  }) as { party: Array<{ equipment: string[] }>; inventory: { weapons: string[] } }
  expect(state.party[0].equipment).toEqual(['0:empty', '1:empty', '2:Hat0'])
  expect(state.inventory.weapons).toEqual(['Thief dagger'])
})

test('falls back to recentBitmap menu labels when visible text is empty', () => {
  const state = modelGameState({
    scene: 'Scene_Equip',
    nearbyEvents: [],
    renderedText: { visible: [], recentBitmap: ['武器', '<空>', '盾牌', '<空>'] },
  }) as { renderedText: string[] }
  expect(state.renderedText).toEqual(['武器', '<空>', '盾牌'])
})

test('compacts interaction results without dropping navigation outcome', () => {
  const result = modelGameState({
    eventId: 12,
    name: 'EV012',
    outcome: 'done',
    messages: [{ text: 'ok' }],
    navigation: { plannedSteps: 12, replanCount: 2, actualPath: Array.from({ length: 100 }, () => ({ x: 1, y: 1 })), finalPosition: { x: 2, y: 3 } },
  }) as Record<string, unknown>
  expect(result).toMatchObject({ eventId: 12, outcome: 'done', navigation: { plannedSteps: 12, replanCount: 2, finalPosition: { x: 2, y: 3 } } })
  expect(JSON.stringify(result)).not.toContain('actualPath')
})
