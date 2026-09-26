import { describe, expect, it, jest } from '@jest/globals'

describe('plugin log history', () => {
  it('shares bounded logs and notifications across separate plugin bundles while offline', async () => {
    jest.useFakeTimers()
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const previousStore = Object.getOwnPropertyDescriptor(globalThis, '__chayaPluginLogs')
    const gameWindow = new EventTarget()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: gameWindow })
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {})
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let first!: typeof import('@/plugins/src/helpers/net/logger')
      let second!: typeof import('@/plugins/src/helpers/net/logger')
      await jest.isolateModulesAsync(async () => {
        first = await import('@/plugins/src/helpers/net/logger')
      })
      await jest.isolateModulesAsync(async () => {
        second = await import('@/plugins/src/helpers/net/logger')
      })
      const changed = jest.fn()
      const unsubscribe = second.subscribeLocalPluginLogs(changed)
      first.ChayaLog.info('ChayaRuntime', '启动')
      second.ChayaLog.warn('ChayaTrans', '本机翻译失败')
      expect(second.readLocalPluginLogs().map(({ source, message }) => [source, message])).toEqual([
        ['ChayaRuntime', '启动'],
        ['ChayaTrans', '本机翻译失败'],
      ])
      expect(changed).toHaveBeenCalledTimes(2)
      first.ChayaLog.ok('ChayaTrans', '热更新 → /Users/alice/Develop/private/game/www/chaya/translate/cache.ndjson', {
        path: 'C:\\Users\\Alice\\private\\game\\www\\chaya\\translate\\cache.ndjson',
        stack: 'at /home/bob/private/engine/loader.js',
      })
      const sanitized = second.readLocalPluginLogs().at(-1)!
      expect(sanitized.message).toContain('~/www/chaya/translate/cache.ndjson')
      expect(sanitized.meta).toEqual([{ path: '~/www/chaya/translate/cache.ndjson', stack: 'at ~/engine/loader.js' }])
      expect(JSON.stringify(sanitized)).not.toMatch(/alice|Alice|bob|private/)
      expect(JSON.stringify(consoleLog.mock.calls.at(-1))).not.toMatch(/alice|Alice|bob|private/)
      for (let i = 0; i < 301; i++) first.ChayaLog.info('ChayaEdit', `消息 ${i}`)
      expect(second.readLocalPluginLogs()).toHaveLength(300)
      expect(second.readLocalPluginLogs().at(-1)?.message).toBe('消息 300')
      second.clearLocalPluginLogs()
      expect(first.readLocalPluginLogs()).toEqual([])
      expect(changed).toHaveBeenCalledTimes(305)
      unsubscribe()
      first.ChayaLog.info('ChayaEdit', '退订后')
      expect(changed).toHaveBeenCalledTimes(305)
    } finally {
      consoleLog.mockRestore()
      consoleWarn.mockRestore()
      jest.clearAllTimers()
      jest.useRealTimers()
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
      if (previousStore) Object.defineProperty(globalThis, '__chayaPluginLogs', previousStore)
      else Reflect.deleteProperty(globalThis, '__chayaPluginLogs')
    }
  })
})
