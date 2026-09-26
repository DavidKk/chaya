import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const redirect = jest.fn((url?: string) => {
  const err = new Error(`NEXT_REDIRECT:${url ?? ''}`)
  ;(err as Error & { digest?: string }).digest = 'NEXT_REDIRECT'
  throw err
})
const notFound = jest.fn(() => {
  const err = new Error('NEXT_NOT_FOUND')
  ;(err as Error & { digest?: string }).digest = 'NEXT_NOT_FOUND'
  throw err
})

jest.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}))

function expectRedirect(fn: () => unknown | Promise<unknown>, to: string) {
  return expect(Promise.resolve().then(() => fn())).rejects.toThrow(`NEXT_REDIRECT:${to}`)
}

describe('页面路由契约', () => {
  beforeEach(() => {
    redirect.mockClear()
    notFound.mockClear()
  })

  it('/ → /game', async () => {
    const { default: Home } = await import('@/app/page')
    await expectRedirect(() => Home(), '/game')
  })

  it('/game 导出默认页', async () => {
    const mod = await import('@/app/game/page')
    expect(typeof mod.default).toBe('function')
    const el = mod.default()
    expect(el).toBeTruthy()
  })

  it('/cheat → 默认 tab', async () => {
    const { DEFAULT_TAB, editTabHref } = await import('@/components/game-edit/tabs')
    const { default: CheatIndex } = await import('@/app/cheat/page')
    await expectRedirect(() => CheatIndex(), editTabHref(DEFAULT_TAB))
  })

  it('/cheat/[tab] 非法 tab 回默认', async () => {
    const { DEFAULT_TAB, editTabHref } = await import('@/components/game-edit/tabs')
    const { default: CheatTabPage } = await import('@/app/cheat/[tab]/[[...pane]]/page')
    await expectRedirect(() => CheatTabPage({ params: Promise.resolve({ tab: 'nope' }) }), editTabHref(DEFAULT_TAB))
  })

  it('/cheat/run 合法 tab 放行', async () => {
    const { default: CheatTabPage } = await import('@/app/cheat/[tab]/[[...pane]]/page')
    await expect(CheatTabPage({ params: Promise.resolve({ tab: 'run' }) })).resolves.toBeNull()
  })

  it('/cheat/actor/12/states 合法四级路径', async () => {
    const { default: CheatTabPage } = await import('@/app/cheat/[tab]/[[...pane]]/page')
    await expect(CheatTabPage({ params: Promise.resolve({ tab: 'actor', pane: ['12', 'states'] }) })).resolves.toBeNull()
  })

  it('/cheat/actor/states 旧链回角色根', async () => {
    const { editActorHref } = await import('@/components/game-edit/tabs')
    const { default: CheatTabPage } = await import('@/app/cheat/[tab]/[[...pane]]/page')
    await expectRedirect(() => CheatTabPage({ params: Promise.resolve({ tab: 'actor', pane: ['states'] }) }), editActorHref(null))
  })

  it('/cheat/bag/extra 多余段回 tab 根', async () => {
    const { editTabHref } = await import('@/components/game-edit/tabs')
    const { default: CheatTabPage } = await import('@/app/cheat/[tab]/[[...pane]]/page')
    await expectRedirect(() => CheatTabPage({ params: Promise.resolve({ tab: 'bag', pane: ['extra'] }) }), editTabHref('bag'))
  })

  it('/translate → 默认 tab', async () => {
    const { DEFAULT_TRANSLATE_TAB, translateTabHref } = await import('@/components/translate/tabs')
    const { default: TranslateIndex } = await import('@/app/translate/page')
    await expectRedirect(() => TranslateIndex(), translateTabHref(DEFAULT_TRANSLATE_TAB))
  })

  it('/translate/[tab] 非法 → notFound', async () => {
    const { default: TranslateTabPage } = await import('@/app/translate/[tab]/page')
    await expect(TranslateTabPage({ params: Promise.resolve({ tab: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('/translate/[tab] generateStaticParams 覆盖全部 tab', async () => {
    const { TRANSLATE_TABS } = await import('@/components/translate/tabs')
    const { generateStaticParams } = await import('@/app/translate/[tab]/page')
    expect(generateStaticParams()).toEqual(TRANSLATE_TABS.map((t) => ({ tab: t.id })))
  })

  it('/cache → /translate/cache', async () => {
    const { translateTabHref } = await import('@/components/translate/tabs')
    const { default: CacheRedirect } = await import('@/app/cache/page')
    await expectRedirect(() => CacheRedirect(), translateTabHref('cache'))
  })

  it('/edit → /cheat/run；/edit/foo/bar → /cheat/foo/bar', async () => {
    const { default: EditCompat } = await import('@/app/edit/[[...slug]]/page')
    await expectRedirect(() => EditCompat({ params: Promise.resolve({}) }), '/cheat/run')
    await expectRedirect(() => EditCompat({ params: Promise.resolve({ slug: ['bag'] }) }), '/cheat/bag')
    await expectRedirect(() => EditCompat({ params: Promise.resolve({ slug: ['actor', '3', 'skills'] }) }), '/cheat/actor/3/skills')
  })

  it('/logs 导出默认页', async () => {
    const mod = await import('@/app/logs/page')
    expect(typeof mod.default).toBe('function')
    expect(mod.default()).toBeTruthy()
  })
})
