/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { PanelHeadEndHost, PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { TranslateEnginesPane } from '@/components/translate/TranslateEnginesPane'
import { MESSAGES } from '@/lib/i18n/messages'
import { translate } from '@/lib/i18n/t'

const mockTranslationFetch = jest.fn()
const mockNotify = { success: jest.fn(), error: jest.fn(), warning: jest.fn() }
jest.mock('@/components/translate/TranslationRuntimeContext', () => ({ useTranslationFetch: () => mockTranslationFetch }))
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))

let mockPathname = '/translate/engines'
let mockSearchParams = new URLSearchParams()
const applyHref = (href: string) => {
  const url = new URL(href, 'http://localhost')
  mockPathname = url.pathname
  mockSearchParams = url.searchParams
}
const mockPush = jest.fn(applyHref)
const mockReplace = jest.fn(applyHref)
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

const sampleState = {
  switches: { bing: true, google: false, apple: false, bergamot: false },
  agents: [
    {
      id: 'agent_1',
      profileId: 'deepseek',
      model: 'deepseek-chat',
      enabled: true,
      allowConcurrency: true,
      concurrencyLimit: 8,
      maxConcurrentChars: 5000,
    },
  ],
  order: ['agent:agent_1', 'bing', 'google', 'apple', 'bergamot'],
  configs: {
    bing: { id: 'eng_bing1', enabled: true, allowConcurrency: true, concurrencyLimit: 1, maxConcurrentChars: 3000 },
    google: { id: 'eng_goog1', enabled: false, allowConcurrency: true, concurrencyLimit: 1, maxConcurrentChars: 3000 },
    apple: { id: 'eng_appl1', enabled: false, allowConcurrency: true, concurrencyLimit: 1, maxConcurrentChars: 40000 },
    bergamot: { id: 'eng_berg1', enabled: false, allowConcurrency: false, concurrencyLimit: 1, maxConcurrentChars: 3000 },
  },
}

const agentsBody = {
  profiles: [
    { id: 'deepseek', label: 'DeepSeek AI', defaultModel: 'deepseek-chat' },
    { id: 'claude', label: 'Claude AI', defaultModel: 'claude-3-5' },
  ],
  models: {
    deepseek: [{ name: 'deepseek-chat' }, { name: 'deepseek-reasoner' }],
  },
}

describe('TranslateEnginesPane (3 Cards & Detail View)', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mockTranslationFetch.mockReset()
    mockPathname = '/translate/engines'
    mockSearchParams = new URLSearchParams()
    mockPush.mockClear()
    mockReplace.mockClear()
    Object.values(mockNotify).forEach((fn) => fn.mockReset())
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    mockTranslationFetch.mockImplementation(async (_path: string, init?: { body: string }) => {
      const mode = init?.body ? JSON.parse(init.body).mode : undefined
      if (mode === 'agents') return json(agentsBody)
      if (mode === 'apple-status') return json({ installed: true, status: 'installed' })
      if (mode === 'bergamot-status') return json({ installed: false, status: 'unavailable' })
      return json(sampleState)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('renders 3 separate cards with concurrency badges for agent, platform and system engines', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })
    await act(async () => {})

    // Card 1: Agent
    const agentCard = host.querySelector('section[aria-label="Agent"]')
    expect(agentCard).not.toBeNull()
    expect(agentCard?.textContent).toContain('DeepSeek AI')
    expect(agentCard?.textContent).toContain('并发 8 · 5,000 字')

    // Card 2: Platform
    const platformCard = host.querySelector('section[aria-label="翻译平台"]')
    expect(platformCard).not.toBeNull()
    expect(platformCard?.textContent).toContain('Bing')
    expect(platformCard?.textContent).toContain('Google')
    expect(platformCard?.textContent).toContain('免费')

    // Card 3: System / Offline
    const systemCard = host.querySelector('section[aria-label="离线机翻"]')
    expect(systemCard).not.toBeNull()
    expect(systemCard?.textContent).toContain('Apple 原生')
    expect(systemCard?.textContent).toContain('Bergamot')
    expect(systemCard?.textContent).toContain('就绪')
  })

  it('shows the overview skeleton while engine settings load', async () => {
    let resolveState: ((value: ReturnType<typeof json>) => void) | undefined
    mockTranslationFetch.mockImplementation((_path: string, init?: { body: string }) => {
      const mode = init?.body ? JSON.parse(init.body).mode : undefined
      if (mode === 'agents') return Promise.resolve(json(agentsBody))
      if (mode === 'switches') {
        return new Promise((resolve) => {
          resolveState = resolve
        })
      }
      return Promise.resolve(json(sampleState))
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })

    expect(host.querySelector('[aria-label="加载翻译工具"]')).not.toBeNull()
    expect(host.querySelector('section[aria-label="Agent"]')).toBeNull()

    await act(async () => resolveState?.(json(sampleState)))
    expect(host.querySelector('[aria-label="加载翻译工具"]')).toBeNull()
    expect(host.querySelector('section[aria-label="Agent"]')).not.toBeNull()
  })

  it.each([
    ['zh', '是否允许并发'],
    ['cht', '允許並行請求'],
    ['en', 'Allow concurrent requests'],
    ['ja', '並列リクエストを許可'],
    ['ko', '동시 요청 허용'],
    ['fr', 'Autoriser les requêtes simultanées'],
    ['de', 'Parallele Anfragen zulassen'],
    ['es', 'Permitir solicitudes simultáneas'],
    ['ru', 'Разрешить параллельные запросы'],
    ['pt-BR', 'Permitir solicitações simultâneas'],
  ] as const)('localizes tool descriptions, edit actions and detail fields in %s', async (locale, concurrencyLabel) => {
    const copy = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(MESSAGES[locale], key, params)
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale={locale} initialPreference={locale}>
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })
    expect(host.textContent).toContain(copy('translate.engineBingDesc'))
    expect(host.textContent).toContain(copy('translate.engineAppleDesc'))
    expect(host.textContent).not.toContain('translate.concurrencyBadge')
    const editLabel = copy('translate.agentEdit', { name: 'Google' })
    const edit = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === editLabel)
    expect(edit).toBeDefined()
    await act(async () => edit!.click())
    expect(host.querySelector(`button[aria-label="${concurrencyLabel}"]`)).not.toBeNull()
    expect(host.textContent).toContain(copy('translate.maxConcurrentChars'))
    const save = host.querySelector(`button[aria-label="${copy('common.save')}"]`)
    expect(save).not.toBeNull()
    expect(save?.textContent).toBe(copy('common.save'))
    expect(save?.getAttribute('data-variant')).toBe('accent')
    expect(host.querySelector('[role="toolbar"]')?.textContent).not.toContain(copy('common.cancel'))
    const backLabel = copy('translate.backToEngines')
    expect([...host.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === backLabel)).toBe(true)
    expect(host.querySelectorAll('section')).toHaveLength(1)
    if (locale === 'en') expect(host.textContent).not.toMatch(/[\p{Script=Han}]/u)
  })

  it('navigates to detail view when clicking the engine title', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })
    await act(async () => {})

    const bingTitle = host.querySelector<HTMLButtonElement>('button[aria-label="编辑 Bing"]')
    expect(bingTitle).not.toBeNull()

    await act(async () => {
      bingTitle?.click()
    })
    await act(async () => {})

    expect(mockPush).toHaveBeenCalledWith('/translate/engines/eng_bing1')

    // Now in Detail View
    expect(host.querySelector('button[aria-label="返回翻译工具列表"]')?.textContent).toBe('返回')
    expect(host.textContent).toContain('是否允许并发')
    expect(host.textContent).toContain('并发请求数上限')
    expect(host.textContent).toContain('并发最多多少个字符')

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="返回翻译工具列表"]')!.click()
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })
    await act(async () => {})

    // Back to 3 cards list
    expect(host.querySelector('section[aria-label="Agent"]')).not.toBeNull()
    expect(host.querySelector('section[aria-label="翻译平台"]')).not.toBeNull()
  })

  it('persists modified concurrency and character settings from detail view', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })
    await act(async () => {})

    // Open DeepSeek agent detail view
    const agentConfigBtn = host.querySelector<HTMLButtonElement>('button[aria-label="编辑 DeepSeek AI"]')
    await act(async () => {
      agentConfigBtn?.click()
    })
    await act(async () => {})

    const charsInput = host.querySelector<HTMLInputElement>('input[aria-label="并发最多多少个字符"]')
    expect(charsInput).not.toBeNull()

    await act(async () => {
      if (charsInput) {
        charsInput.focus()
        charsInput.value = '8000'
        charsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        charsInput.blur()
      }
    })

    const saveBtn = host.querySelector<HTMLButtonElement>('button[aria-label="保存"]')
    expect(saveBtn).not.toBeNull()

    await act(async () => {
      saveBtn?.click()
    })

    expect(mockTranslationFetch).toHaveBeenCalledWith(
      '/api/translate',
      expect.objectContaining({
        body: expect.stringContaining('"maxConcurrentChars":8000'),
      })
    )
  })

  it('places text actions at the bottom of the single detail card and returns to the list', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <header>
              <PanelHeadEndHost />
            </header>
            <TranslateEnginesPane />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="编辑 DeepSeek AI"]')!.click())
    const header = host.querySelector('header')!
    expect(header.querySelector('[role="toolbar"]')).toBeNull()
    const card = host.querySelector('section')!
    expect(host.querySelectorAll('section')).toHaveLength(1)
    expect(card.lastElementChild?.getAttribute('role')).toBe('toolbar')
    expect(card.querySelector('button[aria-label="保存"]')?.textContent).toBe('保存')
    expect(header.textContent).toBe('')
    const remove = card.querySelector('[aria-label="移除"]')
    expect(remove).not.toBeNull()
    expect(remove?.textContent).toBe('删除')
    expect(remove?.getAttribute('data-variant')).not.toBe('plain')
    expect(card.querySelector('button[aria-label="返回翻译工具列表"]')?.textContent).toBe('返回')
    expect(header.querySelector('button[aria-label="返回翻译工具列表"]')).toBeNull()
    await act(async () => {
      card.querySelector<HTMLButtonElement>('button[aria-label="返回翻译工具列表"]')!.click()
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <header>
              <PanelHeadEndHost />
            </header>
            <TranslateEnginesPane />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })
    expect(header.querySelector('[role="toolbar"]')).toBeNull()
    expect(host.querySelector('section[aria-label="Agent"]')).not.toBeNull()
  })
})
