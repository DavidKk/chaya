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
