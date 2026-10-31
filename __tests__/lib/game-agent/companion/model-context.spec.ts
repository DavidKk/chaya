import { trimCompanionContext } from '@/lib/game-agent/companion/model-context'

test('keeps all mandatory instructions and latest JSON without slicing it', () => {
  const messages = [
    { role: 'system', content: 'policy' },
    { role: 'user', content: 'old request'.repeat(10) },
    { role: 'assistant', content: 'old reply' },
    { role: 'system', content: 'constraints' },
    { role: 'user', content: '{"goal":"heal ally"}' },
  ]
  const required = messages[0].content.length + messages[3].content.length + messages[4].content.length
  const result = trimCompanionContext(messages, required)
  expect(result).toEqual([messages[0], messages[3], messages[4]])
  result[0].content = 'changed'
  expect(messages[0].content).toBe('policy')
  expect(() => trimCompanionContext(messages, required - 1)).toThrow('exceeds budget')
})

test('retains recent whole turns in chronological order up to the budget', () => {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'x'.repeat(100) },
    { role: 'assistant', content: 'recent' },
    { role: 'user', content: 'newest' },
  ]
  expect(trimCompanionContext(messages, 18)).toEqual([messages[0], messages[2], messages[3]])
  expect(trimCompanionContext([], 0)).toEqual([])
  try {
    trimCompanionContext(messages, 1)
    throw new Error('Expected overflow')
  } catch (error) {
    expect(error).toMatchObject({ code: 'REQUEST_CONFLICT', retryable: false })
  }
})
