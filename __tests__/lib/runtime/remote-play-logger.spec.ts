/**
 * @jest-environment jsdom
 */
import { detectDeviceDiagnostics, RemotePlayLogger } from '@/lib/runtime/remote-play-logger'

describe('remote-play-logger', () => {
  let logger: RemotePlayLogger
  let fetchMock: jest.Mock

  beforeEach(() => {
    logger = new RemotePlayLogger()
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, count: 1 }),
    })
    globalThis.fetch = fetchMock
  })

  it('detects device diagnostics with fallbacks in jsdom', () => {
    const diag = detectDeviceDiagnostics()
    expect(diag).toHaveProperty('userAgent')
    expect(diag).toHaveProperty('platform')
    expect(diag).toHaveProperty('os')
    expect(diag).toHaveProperty('browser')
    expect(diag).toHaveProperty('screen')
    expect(diag).toHaveProperty('viewport')
    expect(typeof diag.isIOS).toBe('boolean')
    expect(typeof diag.webrtcSupported).toBe('boolean')
  })

  it('records logs with normalized levels and notifies subscribers', () => {
    const received: Array<{ level: string; message: string }> = []
    const unsub = logger.subscribe((entries) => {
      received.length = 0
      for (const e of entries) {
        received.push({ level: e.level, message: e.message })
      }
    })

    logger.info('hello info', { foo: 'bar' })
    logger.ok('hello ok')
    logger.warn('hello warn')
    logger.fail('hello fail')
    logger.error('hello error') // maps to fail
    logger.debug('hello debug')

    const entries = logger.getEntries()
    expect(entries).toHaveLength(6)
    expect(entries[0].level).toBe('info')
    expect(entries[0].meta).toEqual({ foo: 'bar' })
    expect(entries[1].level).toBe('ok')
    expect(entries[2].level).toBe('warn')
    expect(entries[3].level).toBe('fail')
    expect(entries[4].level).toBe('fail')
    expect(entries[5].level).toBe('debug')

    expect(received).toHaveLength(6)
    unsub()
  })

  it('limits buffer capacity and clears properly', () => {
    for (let i = 0; i < 220; i++) {
      logger.info(`msg ${i}`)
    }
    const entries = logger.getEntries()
    expect(entries.length).toBe(200)
    expect(entries[0].message).toBe('msg 20')
    expect(entries[entries.length - 1].message).toBe('msg 219')

    logger.clear()
    expect(logger.getEntries().length).toBe(0)
  })

  it('flushes pending logs to /api/logs with POST and clears pending on success', async () => {
    logger.info('test sync 1')
    logger.info('test sync 2')

    const flushed = await logger.flush()
    expect(flushed).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/logs',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(callBody.entries).toHaveLength(2)
    expect(callBody.entries[0].message).toBe('test sync 1')
    expect(callBody.entries[1].message).toBe('test sync 2')
  })

  it('retains pending logs if /api/logs returns non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    logger.info('fail message')
    const flushed = await logger.flush()
    expect(flushed).toBe(false)

    // Retry should still have the message
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })
    const retried = await logger.flush()
    expect(retried).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('exports logs as formatted text including device header', () => {
    logger.info('handshake init')
    logger.ok('handshake success')

    const text = logger.exportAsText()
    expect(text).toContain('=== Chaya Remote Play Diagnostic Logs ===')
    expect(text).toContain('[INFO ] handshake init')
    expect(text).toContain('[OK   ] handshake success')
  })
})
