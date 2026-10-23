/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { TranslateEnginesPane } from '@/components/translate/TranslateEnginesPane'

const mockTranslationFetch = jest.fn()
const mockNotify = { success: jest.fn(), error: jest.fn(), warning: jest.fn() }
jest.mock('@/components/translate/TranslationRuntimeContext', () => ({ useTranslationFetch: () => mockTranslationFetch }))
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))

let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/translate/engines',
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
    bing: { enabled: true, allowConcurrency: true, concurrencyLimit: 4, maxConcurrentChars: 3000 },
    google: { enabled: false, allowConcurrency: true, concurrencyLimit: 4, maxConcurrentChars: 3000 },
    apple: { enabled: false, allowConcurrency: true, concurrencyLimit: 40, maxConcurrentChars: 40000 },
    bergamot: { enabled: false, allowConcurrency: false, concurrencyLimit: 1, maxConcurrentChars: 3000 },
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
    mockSearchParams = new URLSearchParams()
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

  it('renders 3 separate cards for agent, platform, and system engines with badges', async () => {
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
    expect(agentCard?.textContent).toContain('并发 8 · 5,000字')

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

  it('navigates to detail view when clicking "配置" on an engine', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEnginesPane />
        </LocaleProvider>
      )
    })
    await act(async () => {})

    const configButtons = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent?.includes('配置'))
    expect(configButtons.length).toBeGreaterThanOrEqual(3)

    // Click configure on Bing
    const bingConfigBtn = host.querySelector<HTMLButtonElement>('button[aria-label="配置 Bing"]')
    expect(bingConfigBtn).not.toBeNull()

    await act(async () => {
      bingConfigBtn?.click()
    })
    await act(async () => {})

    // Now in Detail View
    expect(host.textContent).toContain('返回翻译工具列表')
    expect(host.textContent).toContain('是否允许并发')
    expect(host.textContent).toContain('并发请求数上限')
    expect(host.textContent).toContain('并发最多多少个字符')

    // Click Back to return to 3 cards
    const backBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('返回翻译工具列表'))
    expect(backBtn).toBeDefined()

    await act(async () => {
      backBtn?.click()
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
    const agentConfigBtn = host.querySelector<HTMLButtonElement>('button[aria-label="配置 DeepSeek AI"]')
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

    const saveBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('保存'))
    expect(saveBtn).toBeDefined()

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
})
