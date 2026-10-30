import { requestPath, startClientOperation } from '@/lib/log/timing'

describe('client timing', () => {
  beforeEach(() => jest.useFakeTimers({ now: 1000 }))
  afterEach(() => jest.useRealTimers())

  it('strips query credentials and fragments from request paths', () => {
    expect(requestPath('https://user:secret@example.com/api/translate?token=private#text')).toBe('/api/translate')
    expect(requestPath('/api/logs?game=private')).toBe('/api/logs')
    expect(requestPath('http://[')).toBe('(invalid-path)')
  })

  it('measures stages and completes once after a wall-clock change', () => {
    const report = jest.fn()
    const timing = startClientOperation(report, 'translation.http', { path: '/api/translate' }, 'request-1')
    jest.advanceTimersByTime(1250)
    jest.setSystemTime(100_000)
    timing.mark('received', { status: 200 })
    timing.end('completed')
    timing.end('failed')
    expect(report).toHaveBeenCalledTimes(3)
    expect(report.mock.calls[2][0]).toMatchObject({ level: 'warn', meta: { elapsedMs: 1250, operationId: 'request-1', outcome: 'completed', slow: true } })
  })

  it('does not fail a request when reporting fails', () => {
    const timing = startClientOperation(
      () => {
        throw new Error('disconnected')
      },
      'translation.rpc',
      {}
    )
    expect(() => timing.fail(new DOMException('private text', 'AbortError'))).not.toThrow()
    const report = jest.fn()
    startClientOperation(report, 'translation.rpc', {}).fail(new DOMException('private text', 'AbortError'))
    expect(report.mock.calls.at(-1)?.[0].meta).toMatchObject({ outcome: 'cancelled' })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private text')
  })
})
