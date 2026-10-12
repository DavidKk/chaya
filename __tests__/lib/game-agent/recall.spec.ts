import { recallTurns, turnsFromMessages } from '@/lib/game-agent/recall'

const turns = [
  ...turnsFromMessages(
    [
      { role: 'user', content: '帮我开宝箱' },
      { role: 'assistant', content: '宝箱打开了，拿到 30 金币。' },
    ],
    { id: 'task-a', at: 1, state: 'completed' }
  ),
  ...turnsFromMessages(
    [
      { role: 'user', content: '和村长对话' },
      { role: 'tool', content: '{"ok":true}' },
      { role: 'assistant', content: `村长说北边的森林有怪物。${'很长的台词'.repeat(500)}` },
      { role: 'user', content: '继续往北走' },
      { role: 'assistant', content: '已经走到森林入口。' },
    ],
    { id: 'task-b', at: 2, state: 'completed' }
  ),
]

describe('agent recall', () => {
  it('pairs stored requests with their replies', () => {
    expect(turns.map((turn) => [turn.id, turn.request])).toEqual([
      ['task-a', '帮我开宝箱'],
      ['task-b:0', '和村长对话'],
      ['task-b:1', '继续往北走'],
    ])
  })

  it('returns only the previous turn by default', () => {
    expect(recallTurns(turns, {})).toMatchObject({ query: null, count: 1, more: true, turns: [{ request: '继续往北走', reply: '已经走到森林入口。' }] })
  })

  it('pages further back with offset', () => {
    expect(recallTurns(turns, { offset: 1, limit: 1 }).turns.map((turn) => turn.request)).toEqual(['和村长对话'])
  })

  it('searches requests and replies by any term and returns whole replies', () => {
    const result = recallTurns(turns, { query: '怪物 宝箱' })
    expect(result.turns.map((turn) => turn.request)).toEqual(['和村长对话', '帮我开宝箱'])
    expect(result.turns[0].reply).toHaveLength(`村长说北边的森林有怪物。${'很长的台词'.repeat(500)}`.length)
    expect(result.more).toBe(false)
  })
})
