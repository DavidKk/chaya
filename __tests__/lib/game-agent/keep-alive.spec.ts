import { keepAliveLabel, keepAliveToMs, msToKeepAlive } from '@/lib/game-agent/keep-alive'

test('parses Ollama keep_alive strings into milliseconds', () => {
  expect(keepAliveToMs('10m')).toBe(600_000)
  expect(keepAliveToMs('1h')).toBe(3_600_000)
  expect(keepAliveToMs('30s')).toBe(30_000)
  expect(keepAliveToMs('250ms')).toBe(250)
  expect(keepAliveToMs('1.5m')).toBe(90_000)
  expect(keepAliveToMs('0')).toBe(0)
  expect(keepAliveToMs('-1')).toBe(-1)
  expect(keepAliveToMs('bogus')).toBe(600_000)
})

test('serializes milliseconds to the shortest exact keep_alive value', () => {
  expect(msToKeepAlive(600_000)).toBe('10m')
  expect(msToKeepAlive(3_600_000)).toBe('1h')
  expect(msToKeepAlive(90_000)).toBe('90s')
  expect(msToKeepAlive(1500)).toBe('1500ms')
  expect(msToKeepAlive(0)).toBe('0')
  expect(msToKeepAlive(-1)).toBe('-1')
})

test('labels the actual duration', () => {
  expect(keepAliveLabel(-1)).toEqual({ kind: 'forever' })
  expect(keepAliveLabel(0)).toEqual({ kind: 'unload' })
  expect(keepAliveLabel(600_000)).toEqual({ kind: 'span', parts: [{ unit: 'min', n: 10 }] })
  expect(keepAliveLabel(5_430_250)).toEqual({
    kind: 'span',
    parts: [
      { unit: 'hour', n: 1 },
      { unit: 'min', n: 30 },
      { unit: 'sec', n: 30 },
      { unit: 'ms', n: 250 },
    ],
  })
})
