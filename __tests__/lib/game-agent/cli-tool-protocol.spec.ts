import { parseCliReply, renderCliPrompt } from '@/lib/game-agent/cli-tool-protocol'

const save = { name: 'chaya_saves_save', description: 'Save the game', inputSchema: { type: 'object', properties: { slot: { type: 'number' } } } }

test('the prompt carries the system text, the tool list and the whole conversation, without Ollama hints', () => {
  const { instructions, prompt } = renderCliPrompt(
    [
      { role: 'system', content: '/no_think\nYou are the companion.' },
      { role: 'user', content: '帮我存档一下' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'chaya_saves_save', arguments: { slot: 1 } } }] },
      { role: 'tool', tool_name: 'chaya_saves_save', content: `{"ok":true,"thumb":"${'A'.repeat(3000)}"}` },
    ],
    [save]
  )
  expect(instructions).toContain('You are the companion.')
  expect(instructions).not.toContain('/no_think')
  expect(instructions).toContain('"name":"chaya_saves_save"')
  expect(instructions).toContain('"tool_calls"')
  expect(prompt).toContain('[user]\n帮我存档一下')
  expect(prompt).toContain('{"tool_calls":[{"name":"chaya_saves_save","arguments":{"slot":1}}]}')
  expect(prompt).toContain('[tool result: chaya_saves_save]')
  expect(prompt).toContain('[binary omitted]')
  expect(prompt).not.toContain('A'.repeat(2000))
})

test('without tools the CLI may follow the caller format instead of the JSON envelope', () => {
  const { instructions } = renderCliPrompt([{ role: 'system', content: 'Return JSON with operate.' }], [])
  expect(instructions).not.toContain('"tool_calls"')
  expect(instructions).toContain('output format the instructions below ask for')
})

test('reasoning stays out of the reply that goes back to the model', () => {
  expect(parseCliReply('Okay, the tool saved it.</think>已为您保存当前游戏版本！')).toEqual({
    role: 'assistant',
    content: '已为您保存当前游戏版本！',
    thought: 'Okay, the tool saved it.',
  })
  expect(parseCliReply('<think>checking</think>\n{"reply":"好的","tool_calls":[]}')).toEqual({
    role: 'assistant',
    content: '好的',
    thought: 'checking',
  })
  expect(parseCliReply('Okay, I saved it.\\</think>已保存到文件 1')).toEqual({
    role: 'assistant',
    content: '已保存到文件 1',
    thought: 'Okay, I saved it.',
  })
})

test('replies parse into Ollama-shaped messages', () => {
  expect(parseCliReply('{"reply":"好的","tool_calls":[{"name":"chaya_saves_save","arguments":{"slot":2}}]}')).toEqual({
    role: 'assistant',
    content: '好的',
    tool_calls: [{ function: { name: 'chaya_saves_save', arguments: { slot: 2 } } }],
  })
  expect(parseCliReply('```json\n{"reply":"done","tool_calls":[]}\n```')).toEqual({ role: 'assistant', content: 'done' })
  expect(parseCliReply('Sure! {"reply":"x","tool_calls":[{"name":"","arguments":{}},{"name":"a","arguments":[1]}]}')).toEqual({
    role: 'assistant',
    content: 'x',
    tool_calls: [{ function: { name: 'a', arguments: {} } }],
  })
})

test('anything that is not the envelope is a plain answer, with fences removed', () => {
  expect(parseCliReply('  今天天气不错  ')).toEqual({ role: 'assistant', content: '今天天气不错' })
  expect(parseCliReply('```json\n{"operate":true,"edit":false}\n```')).toEqual({ role: 'assistant', content: '{"operate":true,"edit":false}' })
})
