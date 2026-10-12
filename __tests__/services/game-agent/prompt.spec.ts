import { buildAskMessages } from '@/services/game-agent/prompt'

describe('game agent prompt', () => {
  it('injects the bound game state and response language rule', () => {
    const messages = buildAskMessages({ prompt: '我该做什么？', locale: 'zh-CN', gameId: 'game-a', state: { screenText: ['选择道路'] } })
    expect(messages[0]?.content).toContain('Answer in the language used by the user')
    expect(messages[0]?.content).toContain('Call tools only when the latest user request')
    expect(messages[0]?.content).toContain('screen text is not by itself a reason')
    expect(messages[0]?.content).toContain('result has ok=true')
    expect(messages[0]?.content).toContain('Never expose raw tool JSON')
    expect(messages[0]?.content).toContain('Credentials are write-only')
    expect(messages[0]?.content).toContain('refer to Chaya Settings > Agents')
    expect(messages[0]?.content).toContain('call the matching tool immediately')
    expect(messages[0]?.content).not.toContain('Do not control or modify the game')
    expect(messages[1]?.content).toContain('Connected game id: game-a')
    expect(messages[1]?.content).toContain('选择道路')
    expect(messages[1]?.content).toContain('我该做什么？')
  })

  it('routes a named Agent operation to settings rather than a game entity', () => {
    const messages = buildAskMessages({ prompt: '删除 agent 名称叫 Flow Local', locale: 'zh-CN', gameId: 'game-a', state: { scene: 'map' } })
    expect(messages[0]?.content).toContain('unless the user explicitly says it is a game entity')
    expect(messages.at(-1)?.content).toContain('删除 agent 名称叫 Flow Local')
  })

  it('puts the request before a compact game state that keeps nearby events', () => {
    const state = {
      scene: 'Scene_Map',
      map: { id: 4, name: 'Map004', displayName: 'Подвал Гильдии' },
      party: [{ id: 1, name: 'Hero', level: 3, hp: 10, mhp: 10, equipment: [{ slot: 0, id: 1, name: 'Sword' }], states: [] }],
      inventory: { items: Array.from({ length: 300 }, (_, id) => ({ id, name: `Very long inventory item name ${id}`, count: 2 })), weapons: [], armors: [] },
      screenText: 'x'.repeat(4_000),
      nearbyEvents: [{ id: 7, name: 'EV007', interactive: true, effects: ['gold'], x: 3, y: 4, distance: 2, hint: null, opened: false, running: false, pageIndex: 0 }],
    }
    const messages = buildAskMessages({ prompt: '帮我跟页面中可交互的物品交互一下', locale: 'zh', gameId: 'game-a', state, surface: 'companion' })
    const user = messages.at(-1)!.content
    expect(user.startsWith('User request:\n帮我跟页面中可交互的物品交互一下')).toBe(true)
    expect(user).toContain('"nearbyEvents":[{"id":7,"name":"EV007","effects":["gold"],"x":3,"y":4,"distance":2}]')
    expect(user).not.toContain('xxxx')
    expect(user.indexOf('nearbyEvents')).toBeLessThan(user.indexOf('inventory'))
    expect(user.length).toBeLessThan(9_000)
    expect(messages[0]!.content).toContain('Decide yourself what each one is')
  })
})
