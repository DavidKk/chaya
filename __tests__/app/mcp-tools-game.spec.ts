jest.mock('@/app/api/status/route', () => ({ GET: jest.fn() }))
jest.mock('@/app/api/launch/route.server', () => ({ POST: jest.fn(), DELETE: jest.fn() }))
jest.mock('@/app/api/plugins/route.server', () => ({ POST: jest.fn(), DELETE: jest.fn() }))
jest.mock('@/app/api/shell/route.server', () => ({ GET: jest.fn(), POST: jest.fn(), DELETE: jest.fn() }))
jest.mock('@/app/api/window/route.server', () => ({ GET: jest.fn(), PUT: jest.fn() }))
jest.mock('@/app/api/translate/route.server', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/extract/route.server', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/translate-cache/route.server', () => ({ GET: jest.fn(), PATCH: jest.fn(), DELETE: jest.fn(), POST: jest.fn() }))
jest.mock('@/services/runtime/agent-bridge', () => ({
  listAgentGames: jest.fn(() => [{ id: 'g1' }]),
  resolveAgentGame: jest.fn((id?: string) => id || 'g1'),
  callAgentGame: jest.fn(async () => ({ ok: true })),
}))

import * as LaunchRoute from '@/app/api/launch/route.server'
import { cacheTools } from '@/app/api/mcp/_tools/cache'
import { editTools } from '@/app/api/mcp/_tools/edit'
import { gameTools } from '@/app/api/mcp/_tools/game'
import { liveTools } from '@/app/api/mcp/_tools/live'
import { translateTools } from '@/app/api/mcp/_tools/translate'
import * as PluginsRoute from '@/app/api/plugins/route.server'
import * as ShellRoute from '@/app/api/shell/route.server'
import * as StatusRoute from '@/app/api/status/route'
import * as TranslateRoute from '@/app/api/translate/route.server'
import * as CacheRoute from '@/app/api/translate-cache/route.server'
import * as WindowRoute from '@/app/api/window/route.server'
import { callAgentGame, listAgentGames } from '@/services/runtime/agent-bridge'

const ctx = { signal: new AbortController().signal }
const okJson = (body: Record<string, unknown> = {}) => Response.json({ ok: true, ...body })
const mocked = (fn: unknown) => fn as jest.Mock
const bodyOf = async (fn: unknown, call = 0) => (mocked(fn).mock.calls[call][0] as Request).json()
const urlOf = (fn: unknown, call = 0) => new URL((mocked(fn).mock.calls[call][0] as Request).url)

describe('game tools', () => {
  it('status trims the view and reports unbound games', async () => {
    mocked(StatusRoute.GET).mockResolvedValueOnce(okJson({ ready: false, serviceMode: 'local', config: {} }))
    expect(await gameTools.chaya_game_status({}, ctx)).toEqual({ ready: false, serviceMode: 'local', error: '尚未绑定游戏', gameRoot: null })
    mocked(StatusRoute.GET).mockResolvedValueOnce(
      okJson({
        ready: true,
        selected: '/g',
        host: { platform: 'darwin' },
        library: [{ gameRoot: '/g', name: 'G', remark: '备注' }],
        plugins: [{ name: 'ChayaEdit', fileExists: true, registered: true, enabled: false }],
        runtime: { gameOnline: true },
        launchToken: 'x',
      })
    )
    const view = (await gameTools.chaya_game_status({}, ctx)) as Record<string, unknown>
    expect(view).toMatchObject({ ready: true, gameRoot: '/g', gameOnline: true, plugins: [{ name: 'ChayaEdit', installed: true, enabled: false }] })
    expect(view).toMatchObject({ name: '备注', os: 'mac', kind: 'content-root', pluginsReady: 1, pluginsTotal: 1, fingerprint: null })
    expect(JSON.stringify(view)).not.toContain('launchToken')
  })

  it('plugins install / clear return the shared plugin counts without route internals', async () => {
    mocked(PluginsRoute.POST).mockResolvedValue(okJson({ launchToken: 'secret', copied: ['ChayaEdit'] }))
    mocked(PluginsRoute.DELETE).mockResolvedValue(okJson({ removed: ['ChayaEdit'] }))
    const plugin = (ready: boolean) => ({ name: 'ChayaEdit', fileExists: ready, registered: ready, enabled: ready })
    mocked(StatusRoute.GET).mockResolvedValueOnce(okJson({ ready: true, selected: '/g', plugins: [plugin(true)] }))
    expect(await gameTools.chaya_game_plugins_install({}, ctx)).toEqual({
      installed: true,
      plugins: [{ name: 'ChayaEdit', installed: true, enabled: true }],
      pluginsReady: 1,
      pluginsTotal: 1,
      hint: expect.any(String),
    })
    mocked(StatusRoute.GET).mockResolvedValueOnce(okJson({ ready: true, selected: '/g', plugins: [plugin(false)] }))
    expect(await gameTools.chaya_game_plugins_clear({}, ctx)).toEqual({
      cleared: true,
      plugins: [{ name: 'ChayaEdit', installed: false, enabled: false }],
      pluginsReady: 0,
      pluginsTotal: 1,
    })
  })

  it('shell_install downloads the latest shell unless a source is given', async () => {
    mocked(ShellRoute.POST).mockImplementation(async () => okJson({ shellApp: '/shell/nwjs.app', config: {} }))
    expect(await gameTools.chaya_game_shell_install({}, ctx)).toEqual({
      pending: false,
      hasShell: true,
      shellApp: '/shell/nwjs.app',
      taskId: null,
      downloadUrl: null,
      hint: expect.any(String),
    })
    await gameTools.chaya_game_shell_install({ shellSource: '/nw.app', force: true }, ctx)
    expect(await bodyOf(ShellRoute.POST, 0)).toEqual({ fetchLatest: true, wait: true })
    expect(await bodyOf(ShellRoute.POST, 1)).toEqual({ shellSource: '/nw.app', force: true })
  })

  it('window reads without args and writes with the bound gameRoot', async () => {
    mocked(WindowRoute.GET).mockResolvedValue(okJson({ window: { width: 816 } }))
    expect(await gameTools.chaya_game_window({}, ctx)).toEqual({ window: { width: 816 } })
    mocked(StatusRoute.GET).mockResolvedValue(okJson({ ready: true, selected: '/g' }))
    mocked(WindowRoute.PUT).mockResolvedValue(okJson())
    await gameTools.chaya_game_window({ window: { width: 1280 } }, ctx)
    expect(await bodyOf(WindowRoute.PUT)).toEqual({ window: { width: 1280 }, gameRoot: '/g' })
  })
})

describe('live tools', () => {
  it('routes edits to the resolved game', async () => {
    await liveTools.chaya_edit_set({ op: 'gold', value: 99999 }, ctx)
    expect(callAgentGame).toHaveBeenCalledWith('g1', 'edit.apply', { op: { op: 'gold', value: 99999 } })
  })

  it('quits the targeted bridge game', async () => {
    await liveTools.chaya_live_quit({ gameId: 'g2' }, ctx)
    expect(callAgentGame).toHaveBeenCalledWith('g2', 'game.quit', {})
    expect(LaunchRoute.DELETE).not.toHaveBeenCalled()
  })

  it('falls back to the launch route when no bridge game is online', async () => {
    mocked(listAgentGames).mockReturnValueOnce([])
    mocked(LaunchRoute.DELETE).mockResolvedValue(okJson())
    expect(await liveTools.chaya_live_quit({}, ctx)).toEqual({ quit: true })
    expect(callAgentGame).not.toHaveBeenCalled()
  })

  it('reads the catalog from the game when gameId is given', async () => {
    mocked(callAgentGame).mockResolvedValueOnce({
      items: [
        { id: 1, name: '药草' },
        { id: 2, name: '旧钥匙' },
      ],
    })
    expect(await editTools.chaya_edit_catalog({ gameId: 'g1', kind: 'items', q: '钥匙' }, ctx)).toEqual({
      kind: 'items',
      total: 2,
      matched: 1,
      entries: [{ id: 2, name: '旧钥匙' }],
    })
    expect(callAgentGame).toHaveBeenCalledWith('g1', 'edit.catalog', {})
  })

  it('rejects unknown keys before reaching the game', async () => {
    await expect(liveTools.chaya_live_press({ key: 'jump' }, ctx)).rejects.toThrow('key')
    expect(callAgentGame).not.toHaveBeenCalled()
  })
})

describe('cache / play settings tools', () => {
  it('cache_query maps args onto query params', async () => {
    mocked(CacheRoute.GET).mockResolvedValue(okJson({ rows: [] }))
    await cacheTools.chaya_cache_query({ q: '剣', nsfw: true, sort: 'hits', pageSize: 2 }, ctx)
    const url = urlOf(CacheRoute.GET)
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '剣', nsfw: '1', sort: 'hits', pageSize: '2' })
  })

  it('cache_update / import validate input', async () => {
    await expect(cacheTools.chaya_cache_update({ zh: 'x' }, ctx)).rejects.toThrow('src')
    await expect(cacheTools.chaya_cache_import({ text: '  ' }, ctx)).rejects.toThrow('text')
  })

  it('play_settings merges partial settings into the current ones', async () => {
    mocked(TranslateRoute.POST)
      .mockResolvedValueOnce(okJson({ contentRoot: '/g/www', settings: { mode: 'pretranslated', timeoutMs: 8000 } }))
      .mockResolvedValueOnce(okJson({ saved: true }))
    await translateTools.chaya_translate_play_settings({ settings: { mode: 'realtime' } }, ctx)
    expect(await bodyOf(TranslateRoute.POST, 1)).toEqual({ mode: 'play-settings', contentRoot: '/g/www', settings: { mode: 'realtime', timeoutMs: 8000 } })
  })
})
