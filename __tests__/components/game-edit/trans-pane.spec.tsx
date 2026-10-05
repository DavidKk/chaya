/** @jest-environment jsdom */
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { GameEditTransPane } from '@/components/game-edit/GameEditTransPane'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { TranslateActivityLog } from '@/components/translate/TranslateActivityLog'
import { TranslationPlaySettings } from '@/components/translate/TranslationPlaySettings'
import { TranslationRuntimeProvider } from '@/components/translate/TranslationRuntimeContext'
import { createTranslationRpc } from '@/lib/runtime/translation-rpc'
import { DEFAULT_PLAY_SETTINGS } from '@/lib/translate/play-settings'
import type { TranslationRuntime } from '@/lib/translate/runtime-api'

const browserDescriptors = ['matchMedia', 'ResizeObserver', 'CSS'].map((key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const)
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn()
  Object.assign(window, {
    CSS: { ...window.CSS, escape: (value: string) => value },
    matchMedia: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
})

afterEach(() => {
  window.localStorage.removeItem('chaya.localePref')
})

afterAll(() => {
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  for (const [key, descriptor] of browserDescriptors) {
    if (descriptor) Object.defineProperty(window, key, descriptor)
    else Reflect.deleteProperty(window, key)
  }
})

test.each(['overlay', 'page'] as const)('%s translation mounts and refreshes without disk HTTP APIs', async (surface) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const originalFetch = globalThis.fetch
  globalThis.fetch = jest.fn().mockRejectedValue(new Error('Web service unavailable'))
  const hostRuntime = globalThis as typeof globalThis & { __chayaTranslationRuntime?: TranslationRuntime }
  const previousRuntime = hostRuntime.__chayaTranslationRuntime
  const runtime: TranslationRuntime = {
    dispose: () => {},
    request: async ({ path, method, body }) => {
      if (path.startsWith('/api/translate-cache') && method === 'GET') {
        return {
          status: 200,
          data: {
            ok: true,
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            q: '',
            engines: ['ollama'],
            items: [{ src: '応接室へ行く', zh: '前往会客室', engine: 'ollama', updatedAt: 0, hitCount: 1 }],
          },
        }
      }
      const mode = body?.mode
      const data =
        mode === 'play-settings'
          ? { settings: DEFAULT_PLAY_SETTINGS, contentRoot: '/game/www' }
          : mode === 'progress'
            ? { ok: true, activity: { logs: [{ id: 1, at: 0, level: 'ok', text: '词库命中：応接室へ行く' }], liveStatus: '词库命中', sessionDone: 0 } }
            : { ok: true }
      return { status: 200, data }
    },
  }
  const webRpc = createTranslationRpc((packet) => gameRpc.receive(packet))
  const gameRpc = createTranslationRpc((packet) => webRpc.receive(packet), runtime.request)
  hostRuntime.__chayaTranslationRuntime = surface === 'overlay' ? runtime : undefined
  function Pane({ refreshKey = 0 }: { refreshKey?: number }) {
    const [tab, setTab] = useState<'play' | 'seed'>('play')
    const [section, setSection] = useState<'run' | 'cache'>('run')
    const child = (
      <GameEditTransPane surface={surface} refreshKey={refreshKey} {...(surface === 'overlay' ? { tab, onTabChange: setTab, section, onSectionChange: setSection } : {})} />
    )
    return surface === 'overlay' ? (
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <ConfirmProvider>{child}</ConfirmProvider>
      </LocaleProvider>
    ) : (
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <TranslationRuntimeProvider request={webRpc.request}>{child}</TranslationRuntimeProvider>
        </NotificationProvider>
      </LocaleProvider>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Pane />))
    expect(host.querySelector('section[aria-label="游玩翻译模式"]')).not.toBeNull()
    expect(host.textContent).toMatch(/Seed/)
    expect(host.querySelector('[aria-label="翻译平台配置"]')).not.toBeNull()
    const play = host.querySelector<HTMLButtonElement>('[role="tab"][data-nav-id="play"]')!
    const seed = host.querySelector<HTMLButtonElement>('[role="tab"][data-nav-id="seed"]')!
    const panels = host.querySelectorAll<HTMLDivElement>('[role="tabpanel"]')
    const timeoutInput = host.querySelector('#translation-timeout')
    expect(host.querySelector('#translation-local-model')).toBeNull()
    expect(host.textContent).not.toContain('保存模式')
    expect(panels[0].hidden).toBe(false)
    expect(panels[1].hidden).toBe(true)
    expect(panels[0].querySelector('[aria-label="翻译活动日志"]')).not.toBeNull()
    if (surface === 'overlay') expect(panels[0].textContent).toContain('词库命中：応接室へ行く')
    await act(async () => seed.click())
    expect(panels[0].hidden).toBe(true)
    expect(panels[1].hidden).toBe(false)
    expect(host.querySelector('[aria-label="翻译活动日志"]')).not.toBeNull()
    await act(async () => seed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(play.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(play)
    expect(host.querySelector('#translation-timeout')).toBe(timeoutInput)

    await act(async () => seed.click())
    await act(async () => root.render(<Pane refreshKey={1} />))
    expect(host.querySelector('section[aria-label="游玩翻译模式"]')).not.toBeNull()
    expect(host.textContent).toMatch(/Seed/)
    expect(host.textContent).not.toContain('对当前游戏 seed 缺词补译')
    if (surface === 'overlay') expect(host.querySelector<HTMLButtonElement>('[role="tab"][data-nav-id="seed"]')?.getAttribute('aria-selected')).toBe('true')

    if (surface === 'overlay') {
      const cache = host.querySelector<HTMLButtonElement>('[data-translate-section-nav] button[aria-label="翻译库"]')!
      await act(async () => cache.click())
      expect(cache.getAttribute('aria-current')).toBe('page')
      expect(host.querySelector('[aria-label="本作翻译库表"]')).not.toBeNull()
      expect(host.textContent).toContain('前往会客室')
      expect(host.querySelector('[aria-label="搜索原文 / 译文"]')?.closest('[class*="ml-auto"]')).not.toBeNull()
    }
  } finally {
    await act(async () => root.unmount())
    webRpc.dispose()
    gameRpc.dispose()
    host.remove()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    hostRuntime.__chayaTranslationRuntime = previousRuntime
    globalThis.fetch = originalFetch
  }
})

test('new log entries scroll only the log viewport even when the retained log count stays the same', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  jest.mocked(HTMLElement.prototype.scrollIntoView).mockClear()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const renderLog = (id: number) => <TranslateActivityLog entries={[{ id, at: 0, level: 'ok', text: `译文 ${id}` }]} />
  try {
    await act(async () => root.render(renderLog(1)))
    const viewport = host.querySelector<HTMLDivElement>('[aria-label="翻译活动日志"]')!
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 900 })
    host.scrollTop = 45
    host.focus()
    const focused = document.activeElement
    await act(async () => root.render(renderLog(2)))
    expect(viewport.scrollTop).toBe(900)
    expect(host.scrollTop).toBe(45)
    expect(document.activeElement).toBe(focused)
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('timeout changes save automatically, retain a failed edit and allow retry without a save button', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let settings = { ...DEFAULT_PLAY_SETTINGS }
  let failSave = true
  const request = jest.fn<ReturnType<TranslationRuntime['request']>, Parameters<TranslationRuntime['request']>>(async ({ body }) => {
    if (body?.settings) {
      if (failSave) return { status: 400, data: { error: { message: '连接中断' } } }
      settings = body.settings as typeof settings
    }
    return { status: 200, data: { settings, contentRoot: '/game/www' } }
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <NotificationProvider>
            <TranslationRuntimeProvider request={request}>
              <TranslationPlaySettings />
            </TranslationRuntimeProvider>
          </NotificationProvider>
        </LocaleProvider>
      )
    )
    const input = host.querySelector<HTMLInputElement>('#translation-timeout')!
    expect(input.type).toBe('text')
    expect(input.getAttribute('inputmode')).toBe('numeric')
    await act(async () => input.focus())
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '12000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value).toBe('12000')
    expect(host.textContent).toContain('12 秒')
    await act(async () => input.blur())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)))
    const saveCall = request.mock.calls.find((call) => call[0].body?.settings && typeof (call[0].body.settings as { timeoutMs?: number }).timeoutMs === 'number')
    expect(saveCall?.[0].body).toMatchObject({ mode: 'play-settings', contentRoot: '/game/www', settings: { timeoutMs: 12000 } })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('设置未保存')
    expect(input.value).toBe('12000')
    expect(host.textContent).not.toContain('保存模式')
    failSave = false
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === '重试')!.click())
    expect(settings.timeoutMs).toBe(12000)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('已保存')
    const realtime = host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="实时翻译"]')!
    const subtitle = host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="字幕翻译"]')!
    expect(realtime.getAttribute('aria-checked')).toBe('false')
    expect(subtitle.getAttribute('aria-checked')).toBe('false')
    await act(async () => realtime.click())
    expect(settings.mode).toBe('realtime')
    expect(realtime.getAttribute('aria-checked')).toBe('true')
    await act(async () => subtitle.click())
    expect(settings.mode).toBe('subtitle')
    expect(realtime.getAttribute('aria-checked')).toBe('false')
    expect(subtitle.getAttribute('aria-checked')).toBe('true')
    await act(async () => subtitle.click())
    expect(settings.mode).toBe('pretranslated')
    expect(subtitle.getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).not.toContain('修改后自动保存')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('local model benchmark reports through toasts instead of an inline result block', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let fail = false
  const request = jest.fn<ReturnType<TranslationRuntime['request']>, Parameters<TranslationRuntime['request']>>(async ({ body }) => {
    if (body?.mode === 'benchmark') {
      if (fail) return { status: 400, data: { ok: false, error: { message: '本地模型没有返回有效译文' } } }
      return { status: 200, data: { sample: '準備', translation: '准备好了', characters: 46, elapsedMs: 1800 } }
    }
    return { status: 200, data: { settings: DEFAULT_PLAY_SETTINGS, contentRoot: '/game/www' } }
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <NotificationProvider>
            <TranslationRuntimeProvider request={request}>
              <TranslationPlaySettings />
            </TranslationRuntimeProvider>
          </NotificationProvider>
        </LocaleProvider>
      )
    )
    const button = () => [...host.querySelectorAll('button')].find((b) => b.textContent === '测试本地模型速度')!
    await act(async () => button().click())
    expect(document.body.textContent).toContain('46 字 · 1.80 秒（本次总耗时）：准备好了')
    expect(host.querySelector('section')?.textContent).not.toContain('准备好了')
    fail = true
    await act(async () => button().click())
    expect(document.body.textContent).toContain('本地模型测速失败：本地模型没有返回有效译文')
    expect(host.querySelector('section [role="alert"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
