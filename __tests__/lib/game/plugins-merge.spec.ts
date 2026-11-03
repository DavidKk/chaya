import { describe, expect, it } from '@jest/globals'

import { PLUGIN_ENV_NAME, PLUGIN_LOADER_NAME } from '@/constants/brand'
import { buildChayaEnvJs, mergeLoaderPluginEntries } from '@/lib/game/plugins-merge'
import { TRACKED_PLUGINS } from '@/lib/game/types'

describe('buildChayaEnvJs', () => {
  it('server mode reports logs over HTTP and clears browser-only globals', () => {
    const js = buildChayaEnvJs('http://127.0.0.1:3927/', { launchToken: 'lt', gameId: 'room' })
    expect(js).toContain('window.CHAYA_LOG_URL = "http://127.0.0.1:3927/api/logs"')
    expect(js).toContain('window.CHAYA_LAUNCH_TOKEN = "lt"')
    expect(js).toContain('delete window.CHAYA_LINK_TOKEN')
    expect(js).toContain('delete window.CHAYA_LOG_TRANSPORT')
    expect(js).toContain('delete window.CHAYA_MCP_GATEWAY')
  })

  it('browser mode carries the link token and keeps logs off the server', () => {
    const js = buildChayaEnvJs('https://chaya.test', { gameId: 'room', linkToken: 'secret', logTransport: 'link' })
    expect(js).toContain('window.CHAYA_LINK_TOKEN = "secret"')
    expect(js).toContain('window.CHAYA_LOG_TRANSPORT = "link"')
    expect(js).toContain('delete window.CHAYA_LOG_URL')
    expect(js).toContain('window.CHAYA_MCP_GATEWAY = true')
  })

  it.each([true, false])('sets host muting independently from window visibility (%s)', (muteHostAudio) => {
    const window: Record<string, unknown> = {}
    const js = buildChayaEnvJs('http://127.0.0.1:3000', { silentMode: false, muteHostAudio })
    new Function('window', js)(window)
    expect(window.__CHAYA_UNMUTE_HOST__).toBe(!muteHostAudio)
    expect(window.CHAYA_SILENT_MODE).toBeUndefined()
  })

  it('clears stale remote audio and window preferences on an ordinary launch', () => {
    const window: Record<string, unknown> = { CHAYA_SILENT_MODE: true, __CHAYA_UNMUTE_HOST__: true }
    new Function('window', buildChayaEnvJs('http://127.0.0.1:3000'))(window)
    expect(window).not.toHaveProperty('CHAYA_SILENT_MODE')
    expect(window).not.toHaveProperty('__CHAYA_UNMUTE_HOST__')
  })
})

describe('mergeLoaderPluginEntries', () => {
  it('置顶 Env + Loader，并去掉 TRACKED', () => {
    const next = mergeLoaderPluginEntries(
      [
        { name: 'SomePlugin', status: true },
        { name: TRACKED_PLUGINS[0], status: true },
        { name: PLUGIN_LOADER_NAME, status: false },
      ],
      { name: PLUGIN_LOADER_NAME, status: true, description: 'loader', parameters: {} }
    )
    expect(next.map((p) => p.name)).toEqual([PLUGIN_ENV_NAME, PLUGIN_LOADER_NAME, 'SomePlugin'])
    expect(next[1]?.status).toBe(true)
  })
})
