jest.mock('@/app/api/status/route', () => ({ GET: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }))
jest.mock('@/app/api/translate/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/extract/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/logs/route', () => ({ DELETE: jest.fn() }))
jest.mock('@/app/api/game-edit/catalog/route', () => ({ GET: jest.fn() }))
jest.mock('@/services/game', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn(), findLibraryEntry: jest.fn(), upsertLibraryEntry: jest.fn() }))
jest.mock('@/services/log', () => ({ listLogs: jest.fn(() => []) }))

import { filterCatalog } from '@/app/api/mcp/_tools/edit'
import { libraryTools } from '@/app/api/mcp/_tools/library'
import { logsTools } from '@/app/api/mcp/_tools/logs'
import { invokeRoute, redactSecrets } from '@/app/api/mcp/_tools/route-invoke'
import { translateTools } from '@/app/api/mcp/_tools/translate'
import * as StatusRoute from '@/app/api/status/route'
import * as TranslateRoute from '@/app/api/translate/route'
import * as game from '@/services/game'
import { listLogs } from '@/services/log'

const ctx = { signal: new AbortController().signal }
const okJson = (body: Record<string, unknown>) => Response.json({ ok: true, ...body })
const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => {
  process.env.CHAYA_AUTH_TOKEN = 'server-token'
})

describe('invokeRoute', () => {
  it('sends the management token, query and body; unwraps ok and strips secrets', async () => {
    const handler = jest.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer server-token')
      expect(new URL(request.url).searchParams.get('q')).toBe('abc')
      expect(new URL(request.url).searchParams.has('empty')).toBe(false)
      expect(await request.json()).toEqual({ a: 1 })
      return okJson({ value: 1, launchToken: 'leak', nested: [{ token: 'x', keep: true, env: { A: 1 } }] })
    })
    const out = await invokeRoute(handler, { method: 'POST', path: '/api/x', query: { q: 'abc', empty: '' }, body: { a: 1 } })
    expect(out).toEqual({ value: 1, nested: [{ keep: true }] })
  })

  it('throws the route error message', async () => {
    const handler = jest.fn(async () => Response.json({ ok: false, error: { code: 'BAD', message: '参数不对' } }, { status: 400 }))
    await expect(invokeRoute(handler, { method: 'GET', path: '/api/x' })).rejects.toThrow('参数不对')
  })

  it('redacts recursively without touching primitives', () => {
    expect(redactSecrets('s')).toBe('s')
    expect(redactSecrets({ a: { token: 1, b: 2 } })).toEqual({ a: { b: 2 } })
  })
})

describe('library tools', () => {
  const library = [
    { gameRoot: '/g/one', name: 'Alpha Quest', remark: '通关', kindLabel: 'MZ', missing: false, hasShell: true, lastOpenedAt: 1 },
    { gameRoot: '/g/two', name: 'Beta', remark: null, kindLabel: 'MV', missing: false, hasShell: false, lastOpenedAt: 2 },
  ]

  it('filters by name / remark / path and trims the view', async () => {
    mocked(StatusRoute.GET).mockResolvedValue(okJson({ serviceMode: 'local', config: { gameRoot: '/g/two' }, library }))
    const out = (await libraryTools.chaya_library_list({ q: '通关' }, ctx)) as { current: string; total: number; matched: number; games: { gameRoot: string }[] }
    expect(out).toMatchObject({ current: '/g/two', total: 2, matched: 1 })
    expect(out.games.map((g) => g.gameRoot)).toEqual(['/g/one'])
    expect(Object.keys(out.games[0])).not.toContain('kindLabel')
  })

  it('remark updates the entry without switching the current game', async () => {
    const entry = { gameRoot: '/g/one', name: 'Alpha Quest', remote: false }
    mocked(game.loadConfig).mockReturnValue({ gameRoot: '/g/two', library: [entry] })
    mocked(game.findLibraryEntry).mockReturnValue({ ...entry, remark: '新备注' })
    mocked(game.upsertLibraryEntry).mockReturnValue([{ ...entry, remark: '新备注' }])
    mocked(game.saveConfig).mockReturnValue({ gameRoot: '/g/two', library: [{ ...entry, remark: '新备注' }] })

    const out = await libraryTools.chaya_library_remark({ gameRoot: '/g/one', remark: '新备注' }, ctx)
    expect(out).toEqual({ gameRoot: '/g/one', remark: '新备注' })
    expect(mocked(game.upsertLibraryEntry).mock.calls[0][1]).toMatchObject({ remark: '新备注', touchOpen: false })
    expect(Object.keys(mocked(game.saveConfig).mock.calls[0][0])).toEqual(['library'])
  })

  it('remark rejects unknown games', async () => {
    mocked(game.loadConfig).mockReturnValue({ library: [] })
    mocked(game.findLibraryEntry).mockReturnValue(undefined)
    await expect(libraryTools.chaya_library_remark({ gameRoot: '/nope' }, ctx)).rejects.toThrow('未找到')
    expect(game.saveConfig).not.toHaveBeenCalled()
  })
})

describe('translate tools', () => {
  it('maps job actions onto /api/translate modes', async () => {
    mocked(TranslateRoute.POST).mockImplementation(async () => okJson({}))
    await translateTools.chaya_translate_job({ action: 'status' }, ctx)
    await translateTools.chaya_translate_job({ action: 'start' }, ctx)
    const bodies = await Promise.all(mocked(TranslateRoute.POST).mock.calls.map(([request]: [Request]) => request.json()))
    expect(bodies).toEqual([{ mode: 'progress' }, { mode: 'job', action: 'start' }])
    await expect(translateTools.chaya_translate_job({ action: 'nuke' }, ctx)).rejects.toThrow('action')
  })

  it('validates the text batch', async () => {
    await expect(translateTools.chaya_translate_text({ texts: [] }, ctx)).rejects.toThrow('不能为空')
    await expect(translateTools.chaya_translate_text({ texts: Array.from({ length: 201 }, (_, i) => `t${i}`) }, ctx)).rejects.toThrow('200')
  })
})

describe('edit / logs tools', () => {
  const entries = [
    { id: 1, name: 'Potion', description: 'Heals HP' },
    { id: 2, name: '' },
    { id: 12, name: 'Elixir' },
  ]

  it('filterCatalog matches numeric id exactly, text loosely, and drops blank names by default', () => {
    expect(filterCatalog(entries, '1', 50).entries.map((e) => e.id)).toEqual([1])
    expect(filterCatalog(entries, 'heals', 50).entries.map((e) => e.id)).toEqual([1])
    expect(filterCatalog(entries, undefined, 50)).toMatchObject({ total: 3, matched: 2 })
    expect(filterCatalog(entries, undefined, 1).entries).toHaveLength(1)
  })

  it('logs_query validates level and forwards q', async () => {
    await expect(logsTools.chaya_logs_query({ level: 'loud' }, ctx)).rejects.toThrow('level')
    await logsTools.chaya_logs_query({ q: 'boom', level: 'fail' }, ctx)
    expect(listLogs).toHaveBeenCalledWith(expect.objectContaining({ q: 'boom', level: 'fail', limit: 100 }))
  })
})
