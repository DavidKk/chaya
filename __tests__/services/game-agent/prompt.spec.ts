import { buildAskMessages } from '@/services/game-agent/prompt'

describe('game agent prompt', () => {
  it('injects the bound game state and response language rule', () => {
    const messages = buildAskMessages({ history: [], prompt: '我该做什么？', locale: 'zh-CN', gameId: 'game-a', state: { screenText: ['选择道路'] } })
    expect(messages[0]?.content).toContain('Answer in the language used by the player')
    expect(messages[1]?.content).toContain('Bound game id: game-a')
    expect(messages[1]?.content).toContain('选择道路')
    expect(messages[1]?.content).toContain('我该做什么？')
  })
})
