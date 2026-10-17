import { compileInteractionGoal, interactionEventSignature, remainingInteractionTargets, validateInteractionTarget } from '@/lib/game-agent/interaction-target'

const state = {
  nearbyEvents: [
    { id: 1, kind: 'npc', interactive: true, routeStatus: 'reachable', routeDistance: 1 },
    { id: 2, kind: 'pickup', interactive: true, routeStatus: 'reachable', routeDistance: 3 },
    { id: 3, kind: 'door', transit: true, interactive: true, routeStatus: 'event_boundary', eventBoundaryIds: [4], routeDistance: 4 },
    { id: 4, kind: 'door', interactive: true, routeStatus: 'reachable', routeDistance: 2 },
  ],
}

test('compiles exclusions instead of relying on model wording', () => {
  expect(compileInteractionGoal('除人物、入口之外都帮我交互一下')).toMatchObject({ multi: true, excludedKinds: ['npc', 'door', 'transit'] })
})

test('rejects excluded and stale targets before the game tool runs', () => {
  expect(validateInteractionTarget(state, '除人物、入口之外都帮我交互一下', 1, new Set())).toMatchObject({ accepted: false, reason: 'target_excluded' })
  expect(validateInteractionTarget(state, '除人物、入口之外都帮我交互一下', 99, new Set())).toMatchObject({ accepted: false, reason: 'target_missing' })
})

test('only reports reachable targets and permits a door boundary backed by a door', () => {
  expect(remainingInteractionTargets(state, '交互所有人物、门和入口目标', new Set())).toEqual([1, 2, 3, 4])
  expect(remainingInteractionTargets(state, '除人物、入口之外都帮我交互一下', new Set())).toEqual([2])
})

test('treats a changed event page as a new semantic target', () => {
  const before = { nearbyEvents: [{ id: 7, pageIndex: 0, kind: 'npc', sprite: 'Boris', interactive: true }] }
  const after = { nearbyEvents: [{ id: 7, pageIndex: 1, kind: 'pickup', sprite: '!Flame', interactive: true }] }
  expect(interactionEventSignature(before, 7)).not.toBe(interactionEventSignature(after, 7))
})

test('keeps real trace description points while excluding disguised people, doors and exits', () => {
  const traceState = {
    map: { visibleBounds: { minX: 0, minY: 0, maxX: 22, maxY: 16 } },
    nearbyEvents: [
      { id: 11, kind: 'unknown', look: 'tile', trigger: 'player_touch', x: 1, y: 2, effects: ['text'], interactive: true, routeStatus: 'reachable', routeDistance: 1 },
      { id: 5, kind: 'pickup', look: 'character', sprite: 'Boris', effects: ['text', 'armor'], interactive: true, routeStatus: 'reachable', routeDistance: 2 },
      { id: 1, kind: 'object', look: 'object', sprite: '!DoorBigWhite1', effects: [], interactive: true, routeStatus: 'reachable', routeDistance: 3 },
      { id: 6, kind: 'object', look: 'object', sprite: '!Flame', animated: true, effects: ['text'], interactive: true, routeStatus: 'reachable', routeDistance: 4 },
      { id: 7, kind: 'pickup', look: 'object', sprite: '!Flame', animated: true, effects: ['text', 'gold'], interactive: true, routeStatus: 'reachable', routeDistance: 5 },
    ],
  }
  const goal = '除人物、入口之外都帮我交互一下'
  expect(remainingInteractionTargets(traceState, goal, new Set())).toEqual([6, 7])
  expect(validateInteractionTarget(traceState, goal, 11, new Set())).toMatchObject({ accepted: false, kind: 'exit' })
  expect(validateInteractionTarget(traceState, goal, 5, new Set())).toMatchObject({ accepted: false, kind: 'npc' })
  expect(validateInteractionTarget(traceState, goal, 1, new Set())).toMatchObject({ accepted: false, kind: 'door' })
})
