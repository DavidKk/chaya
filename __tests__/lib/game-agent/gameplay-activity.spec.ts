import { decisionEventForTool, gameplayEventsForTool } from '@/lib/game-agent/gameplay-activity'

describe('gameplay activity events', () => {
  it('summarizes a game-state observation', () => {
    expect(
      gameplayEventsForTool({
        name: 'chaya_live_state',
        input: {},
        output: { map: { id: 3, name: '厨房' }, player: { x: 8, y: 11 }, nearbyEvents: [{ id: 12 }] },
        ok: true,
        stepId: 'observe-0',
        actionId: 'observe-0',
        durationMs: 0,
      })
    ).toEqual([
      expect.objectContaining({
        type: 'agent.observation',
        stepId: 'observe-0',
        actionId: 'observe-0',
        summary: '地图：厨房；位置：(8, 11)；附近可互动目标 1 个',
      }),
    ])
  })

  it('turns an interaction result into readable, correlated game events', () => {
    const events = gameplayEventsForTool({
      name: 'chaya_live_interact',
      input: { eventId: 12 },
      output: {
        outcome: 'choice',
        messages: [{ speaker: '老人', text: '里面的东西你可以拿走。' }],
        choices: ['打开箱子', '暂时不打开'],
        goldChange: 20,
        inventoryChanges: [{ name: '高级药水', change: 1 }],
        position: { x: 14, y: 9 },
        navigation: { start: { x: 8, y: 11 }, finalPosition: { x: 14, y: 9 }, outcome: 'arrived' },
      },
      ok: true,
      stepId: 'step-1',
      actionId: '1-0',
      durationMs: 240,
    })

    expect(events.map((event) => event.type)).toEqual([
      'navigation.completed',
      'game.dialogue',
      'game.choices_shown',
      'game.gold_changed',
      'game.inventory_changed',
      'agent.verification',
    ])
    expect(events.every((event) => event.stepId === 'step-1' && event.actionId === '1-0')).toBe(true)
    expect(events.find((event) => event.type === 'game.inventory_changed')?.summary).toBe('获得高级药水 ×1。')
    expect(events.at(-1)?.details).toEqual(expect.objectContaining({ pending: true, outcome: 'choice' }))
  })

  it('records the public reason for a selected interaction', () => {
    expect(decisionEventForTool('chaya_live_interact', { eventId: 12 }, 'step-1', '1-0')).toEqual(
      expect.objectContaining({ type: 'agent.decision', stepId: 'step-1', actionId: '1-0', summary: '选择前往并与目标互动。' })
    )
  })

  it('records the rendered choice selected by an input action', () => {
    const events = gameplayEventsForTool({
      name: 'chaya_live_press',
      input: { key: 'ok' },
      output: { key: 'ok', history: { entries: [{ kind: 'choice', index: 0, text: '打开箱子' }] } },
      ok: true,
      stepId: 'step-2',
      actionId: '2-0',
      durationMs: 80,
    })
    expect(events).toContainEqual(expect.objectContaining({ type: 'game.choice_selected', summary: '选择“打开箱子”。' }))
  })
})
