import { battleRequiresAgentDecision, createGameWatchManager, diffGameState, formatWatchTrigger } from '@/plugins/src/agent/runtime/state-watch'

const mapState = (overrides: Record<string, unknown> = {}) => ({
  scene: 'Scene_Map',
  map: { id: 1 },
  player: { x: 3, y: 3 },
  nearbyEvents: [{ id: 7, kind: 'chest', interactive: true, opened: false, routeDistance: 4, x: 6, y: 3 }],
  message: { busy: false, choices: null, text: null },
  ...overrides,
})

describe('game state watch', () => {
  it('ignores unrelated event movement and reports target changes', () => {
    const before = mapState({ nearbyEvents: [{ id: 2, kind: 'npc', interactive: true, x: 4, y: 3 }] })
    const after = mapState({ nearbyEvents: [{ id: 2, kind: 'npc', interactive: true, x: 5, y: 3 }] })
    expect(diffGameState(before, after, { targetEventIds: [7] })).toEqual([])

    const targetBefore = mapState()
    const targetAfter = mapState({ nearbyEvents: [{ id: 7, kind: 'chest', interactive: true, opened: true, routeDistance: 4, x: 6, y: 3 }] })
    expect(diffGameState(targetBefore, targetAfter, { targetEventIds: [7] })).toContainEqual({ kind: 'target_changed', eventId: 7 })
  })

  it('does not emit watch changes for battle churn or map movement while battle is active', () => {
    const before = mapState({ battle: { instanceId: 'b1', turn: 1, enemies: [{ hp: 10 }] } })
    const after = mapState({ battle: { instanceId: 'b1', turn: 1, enemies: [{ hp: 8 }] }, nearbyEvents: [{ id: 7, kind: 'chest', interactive: true, x: 20, y: 20 }] })
    expect(diffGameState(before, after, { targetEventIds: [7] }, 'battle')).toEqual([])
    expect(diffGameState(mapState(), mapState({ scene: 'Scene_Battle', battle: { instanceId: 'b1', turn: 1 } }))).toEqual([
      { kind: 'scene_changed', detail: { from: 'Scene_Map', to: 'Scene_Battle' } },
      { kind: 'battle_started' },
    ])
  })

  it.each([
    ['enemy action and animation', { battle: { phase: 'action', actor: null }, windows: [], commandInputs: [] }, false],
    ['actor command', { battle: { phase: 'input', actor: { id: 1 } }, windows: [], commandInputs: [] }, true],
    ['active battle window', { battle: { phase: 'input', actor: null }, windows: [{ active: true }], commandInputs: [] }, true],
    ['QTE', { battle: { phase: 'action', actor: null }, qte: { key: 'ok' }, windows: [], commandInputs: [] }, true],
    ['battle dialogue', { battle: { phase: 'action', actor: null }, message: { busy: true }, windows: [], commandInputs: [] }, true],
    ['battle choice', { battle: { phase: 'action', actor: null }, message: { choices: ['yes', 'no'] }, windows: [], commandInputs: [] }, true],
  ])('classifies %s decision readiness', (_name, state, expected) => {
    expect(battleRequiresAgentDecision(state)).toBe(expected)
  })

  it('coalesces a relevant change into a steering trigger', () => {
    const watch = createGameWatchManager()
    const before = mapState()
    watch.setPlan({ targetEventIds: [7] }, 'map_interaction')
    watch.reset(before, 'map_interaction')
    const after = mapState({ nearbyEvents: [] })
    const trigger = watch.update(after)
    expect(trigger).toMatchObject({ phase: 'map_interaction', reason: 'target_removed' })
    expect(formatWatchTrigger(trigger!)).toContain('target_removed eventId=7')
    expect(watch.update(mapState({ nearbyEvents: [] }))).toBeNull()
  })

  it('reports dialogue and choices but ignores ordinary map snapshots', () => {
    const before = mapState()
    expect(diffGameState(before, mapState({ message: { busy: true, choices: null, text: 'hello' } }))).toContainEqual({ kind: 'dialogue_started' })
    expect(diffGameState(before, mapState({ message: { busy: false, choices: ['yes', 'no'], text: null } }))).toContainEqual({ kind: 'choice_opened' })
  })
})
