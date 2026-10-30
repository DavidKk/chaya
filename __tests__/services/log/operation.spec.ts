jest.mock('@/services/log/bus', () => ({ appendLog: jest.fn() }))

import { appendLog } from '@/services/log/bus'
import { measureOperation, operationId, startOperation } from '@/services/log/operation'

describe('operation timing', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 1000 })
  })
  afterEach(() => jest.useRealTimers())

  it('links nested async operations and measures elapsed time independently of wall-clock jumps', async () => {
    await measureOperation('translate', 'parent', { sourceChars: 4000 }, async () => {
      await Promise.resolve()
      const child = startOperation('communication', 'child')
      jest.advanceTimersByTime(1200)
      jest.setSystemTime(900_000)
      child.end()
      child.end()
    })
    const entries = jest.mocked(appendLog).mock.calls.map(([entry]) => ({ ...entry, meta: entry.meta as Record<string, unknown> | undefined }))
    const parent = entries.find((entry) => entry.message === 'parent: started')!
    const child = entries.find((entry) => entry.meta?.operation === 'child' && entry.meta?.outcome === 'completed')!
    expect(child).toMatchObject({ level: 'warn', meta: { parentId: parent.meta?.operationId, elapsedMs: 1200, slow: true, finishedAt: 900_000 } })
    expect(entries.filter((entry) => entry.meta?.operation === 'child' && entry.meta?.outcome)).toHaveLength(1)
    const independent = startOperation('translate', 'independent')
    independent.end()
    expect(jest.mocked(appendLog).mock.calls.at(-1)?.[0].meta).not.toHaveProperty('parentId', expect.anything())
  })

  it.each(['Error', 'AbortError'])('rethrows %s without leaking its message', async (name) => {
    const error = Object.assign(new Error('private source text and credentials'), { name })
    await expect(
      measureOperation('translate', 'request', {}, () => {
        throw error
      })
    ).rejects.toBe(error)
    const entry = jest.mocked(appendLog).mock.calls.at(-1)?.[0]
    expect(entry?.meta).toMatchObject({ outcome: name === 'AbortError' ? 'cancelled' : 'failed', errorName: name })
    expect(JSON.stringify(entry)).not.toContain(error.message)
  })

  it('accepts bounded correlation ids and tolerates log failures', async () => {
    expect(operationId('rpc:request_123')).toBe('rpc:request_123')
    expect(operationId('untrusted\nheader')).toMatch(/^[a-f0-9-]{36}$/)
    jest.mocked(appendLog).mockImplementation(() => {
      throw new Error('disk full')
    })
    await expect(measureOperation('translate', 'request', {}, async () => 42)).resolves.toBe(42)
  })
})
