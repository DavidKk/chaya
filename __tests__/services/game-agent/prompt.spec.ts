import { buildAskMessages, shouldOfferAgentTools } from '@/services/game-agent/prompt'

describe('game agent prompt', () => {
  it('injects the bound game state and response language rule', () => {
    const messages = buildAskMessages({ history: [], prompt: '我该做什么？', locale: 'zh-CN', gameId: 'game-a', state: { screenText: ['选择道路'] } })
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
    const messages = buildAskMessages({ history: [], prompt: '删除 agent 名称叫 Flow Local', locale: 'zh-CN', gameId: 'game-a', state: { scene: 'map' } })
    expect(messages[0]?.content).toContain('unless the user explicitly says it is a game entity')
    expect(messages.at(-1)?.content).toContain('删除 agent 名称叫 Flow Local')
    expect(shouldOfferAgentTools('删除 agent 名称叫 Flow Local')).toBe(true)
  })

  it('keeps greetings and presence checks out of the tool loop', () => {
    expect(shouldOfferAgentTools('在吗')).toBe(false)
    expect(shouldOfferAgentTools('你在吗？')).toBe(false)
    expect(shouldOfferAgentTools('你好！')).toBe(false)
    expect(shouldOfferAgentTools('What can you do?')).toBe(false)
    expect(shouldOfferAgentTools('看看游戏现在进行到哪里')).toBe(true)
    expect(shouldOfferAgentTools('你好，帮我把速度调成两倍')).toBe(true)
  })
})
