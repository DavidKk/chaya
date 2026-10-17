import { parsePlayIntent, parsePlayIntentResult } from '@/lib/game-agent/intent'

test('parses operate with shape and defaults missing shape to open', () => {
  expect(parsePlayIntentResult('{"action":"open all chests","operate":true,"shape":"batch"}')).toEqual({
    action: 'open all chests',
    operate: true,
    shape: 'batch',
  })
  expect(parsePlayIntentResult('{"action":"talk","operate":true}')).toEqual({ action: 'talk', operate: true, shape: 'open' })
  expect(parsePlayIntentResult('{"action":null,"operate":false}')).toEqual({ action: null, operate: false })
  expect(parsePlayIntent('{"operate":true,"action":"x","shape":"single"}')).toBe(true)
})
