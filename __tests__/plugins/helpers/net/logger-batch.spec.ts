import { describe, expect, it, jest } from '@jest/globals'

describe('plugin logger batching & deduplication', () => {
  it('coalesces consecutive duplicate logs into a single batch entry with repeat count', async () => {
    jest.useFakeTimers()
    const postMock = jest.fn(async () => ({ ok: true, status: 200 }))
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }))
    jest.mock('@/plugins/mv/src/helpers/net/http', () => ({
      chayaPostJson: postMock,
      chayaFetch: fetchMock,
    }))

    try {
      let loggerModule!: typeof import('@/plugins/mv/src/helpers/net/logger')
      await jest.isolateModulesAsync(async () => {
        loggerModule = await import('@/plugins/mv/src/helpers/net/logger')
      })

      const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {})
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

      try {
        // Emit 5 identical info logs rapidly
        for (let i = 0; i < 5; i++) {
          loggerModule.ChayaLog.info('TestModule', '正在等待玩家行动')
        }
        // Emit 1 distinct log
        loggerModule.ChayaLog.info('TestModule', '玩家已行动')

        // Before timer fires, no HTTP post
        expect(postMock).not.toHaveBeenCalled()

        // Fast-forward normal batch interval (800ms)
        jest.advanceTimersByTime(800)
        await Promise.resolve() // let flush promise resolve
        await Promise.resolve()

        expect(postMock).toHaveBeenCalledTimes(1)
        const payload = postMock.mock.calls[0][1] as { entries: Array<{ message: string; source: string; level: string }> }
        expect(payload.entries).toHaveLength(2)
        expect(payload.entries[0].message).toBe('[重复 5 次] 正在等待玩家行动')
        expect(payload.entries[1].message).toBe('玩家已行动')
      } finally {
        consoleLog.mockRestore()
        consoleWarn.mockRestore()
        consoleError.mockRestore()
      }
    } finally {
      jest.clearAllTimers()
      jest.useRealTimers()
    }
  })

  it('flushes urgently on warn or fail without waiting full debounce', async () => {
    jest.useFakeTimers()
    const postMock = jest.fn(async () => ({ ok: true, status: 200 }))
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }))
    jest.mock('@/plugins/mv/src/helpers/net/http', () => ({
      chayaPostJson: postMock,
      chayaFetch: fetchMock,
    }))

    try {
      let loggerModule!: typeof import('@/plugins/mv/src/helpers/net/logger')
      await jest.isolateModulesAsync(async () => {
        loggerModule = await import('@/plugins/mv/src/helpers/net/logger')
      })

      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        loggerModule.ChayaLog.fail('CriticalModule', '严重崩溃错误')

        // At 40ms, not yet flushed
        jest.advanceTimersByTime(40)
        expect(postMock).not.toHaveBeenCalled()

        // At 50ms, urgent flush triggers
        jest.advanceTimersByTime(20)
        await Promise.resolve()
        await Promise.resolve()

        expect(postMock).toHaveBeenCalledTimes(1)
        const payload = postMock.mock.calls[0][1] as { entries: Array<{ message: string; level: string }> }
        expect(payload.entries[0].message).toBe('严重崩溃错误')
        expect(payload.entries[0].level).toBe('fail')
      } finally {
        consoleError.mockRestore()
      }
    } finally {
      jest.clearAllTimers()
      jest.useRealTimers()
    }
  })
})
