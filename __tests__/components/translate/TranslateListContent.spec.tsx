/** @jest-environment jsdom */
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { PanelHeadEndHost, PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { TranslateListContent } from '@/components/translate/TranslateListContent'

const mockTranslationFetch = jest.fn()
const mockNotify = { success: jest.fn(), error: jest.fn(), warn: jest.fn(), warning: jest.fn(), info: jest.fn() }
const mockConfirm = jest.fn().mockResolvedValue(true)
const mockRouter = { push: jest.fn(), replace: jest.fn() }

let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/translate/run/list',
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/translate/TranslationRuntimeContext', () => ({
  useTranslationFetch: () => mockTranslationFetch,
}))

jest.mock('@/components/notification/useNotification', () => ({
  useNotification: () => mockNotify,
}))

jest.mock('@/components/confirm/ConfirmProvider', () => ({
  useConfirm: () => mockConfirm,
}))

jest.mock('@/components/sk', () => ({
  Badge: ({ children, className }: any) => <span className={className}>{children}</span>,
  Modal: ({ open, title, description, children, footer }: any) =>
    open ? (
      <div data-testid="mock-modal">
        <div>{title}</div>
        <div>{description}</div>
        {children}
        {footer}
      </div>
    ) : null,
  Button: ({ children, onClick, disabled, loading, variant, size, className, 'aria-label': ariaLabel, tooltip, title }: any) => (
    <button onClick={onClick} disabled={disabled || loading} className={className} data-variant={variant} data-size={size} aria-label={ariaLabel} title={tooltip || title}>
      {children}
    </button>
  ),
  EmptyState: ({ title, description, action }: any) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {action}
    </div>
  ),
  PlainTextEditor: ({ value, onChange, disabled, 'aria-label': ariaLabel, className }: any) => (
    <div data-testid="plain-text-editor" aria-label={ariaLabel} className={className}>
      {disabled ? <span>{value}</span> : <input value={value} onChange={(e) => onChange?.(e.target.value)} />}
    </div>
  ),
  Select: ({ value, onChange, options, ariaLabel }: any) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
  Spinner: () => <div>Loading...</div>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TextInput: ({ value, onChange, placeholder, search: _search, ...rest }: any) => <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />,
  NumberInput: ({ value, onValueChange, min, max, className }: any) => (
    <input type="number" value={value} min={min} max={max} className={className} onChange={(e) => onValueChange(Number(e.target.value))} />
  ),
  LanguagePairSelect: ({ sourceLang, targetLang }: any) => (
    <div data-testid="lang-pair-select">
      {sourceLang} - {targetLang}
    </div>
  ),
  ScrollArea: ({ children, className }: any) => <div className={className}>{children}</div>,
  VirtualList: ({ count, renderRow }: any) => (
    <div>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>{renderRow(index)}</div>
      ))}
    </div>
  ),
}))

describe('TranslateListContent', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mockSearchParams = new URLSearchParams()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    jest.clearAllMocks()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('applies the confirmed name preview and reloads the list', async () => {
    mockSearchParams = new URLSearchParams('q=Rei&nature=name&category=actor')
    let applied = false
    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      let data: Record<string, unknown> = { ok: true }
      if (body.mode === 'extract-items') {
        data.items = [
          { id: '1', src: 'Rei', zh: '蕾', savedZh: '蕾', meta: { category: 'actor' } },
          { id: '2', src: "Rei's Baby", zh: applied ? '蕾的宝宝' : '丽的宝贝', meta: { category: 'actor' } },
        ]
      } else if (body.action === 'scan-names') {
        data = { ok: true, previewId: 'preview-1', candidates: [{ src: "Rei's Baby", oldZh: '丽的宝贝', newZh: '蕾的宝宝', via: 'stitch' }] }
      } else if (body.action === 'apply-names') {
        applied = true
        data.applied = 1
      }
      return { ok: true, json: async () => data }
    })
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="同步到句子"]')!
    expect(button.disabled).toBe(false)
    await act(async () => {
      button.click()
    })
    const requests = mockTranslationFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body || '{}')))
    expect(requests.find((body) => body.action === 'scan-names')).toMatchObject({ names: ['Rei', "Rei's Baby"] })
    expect(requests.find((body) => body.action === 'apply-names')).toMatchObject({ previewId: 'preview-1' })
    expect(requests.filter((body) => body.mode === 'extract-items')).toHaveLength(2)
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockNotify.success).toHaveBeenCalled()
    expect(mockNotify.error).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[value="蕾的宝宝"]')).not.toBeNull()
  })

  it('loads items and renders list with categories, save and reset buttons', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'こんにちは',
        zh: '你好',
        savedZh: '你好',
        meta: {
          category: 'dialogue',
          label: '对话',
          speaker: '勇者',
          context: '地图 1',
          file: 'data/data/Map001.json',
        },
      },
      {
        id: '2',
        src: '薬草',
        zh: '',
        meta: {
          category: 'item',
          label: '物品',
          context: '道具',
        },
      },
    ]

    mockTranslationFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      if (body.mode === 'get-switches') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            switches: { google: true, macos: true },
          }),
        }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    // Confirm stats label
    expect(container.textContent).toContain('翻译数量:')

    // Confirm items rendered
    expect(container.textContent).toContain('こんにちは')
    expect(container.textContent).toContain('薬草')
    expect(container.textContent).toContain('勇者')
    expect(container.textContent).toContain('地图 1')
    expect(container.textContent).toContain('Map001.json')

    // Item 1 has row reset; batch reset/save are icon buttons in the top toolbar.
    const resetButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('重置') || b.getAttribute('aria-label') === '重置')
    expect(resetButtons.length).toBe(2)

    const saveButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('保存') || b.getAttribute('aria-label') === '保存')
    expect(saveButtons.length).toBe(3)

    // Translate buttons should be present
    const transButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('翻译'))
    expect(transButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('triggers save item when save button is clicked', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'こんにちは',
        zh: '你好世界',
        meta: {
          category: 'dialogue',
          label: '对话',
        },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      if (body.mode === 'save-item') {
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ ok: true, switches: {} }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '保存译文至游戏')
    expect(saveBtn).toBeDefined()

    await act(async () => {
      saveBtn?.click()
    })

    expect(mockTranslationFetch).toHaveBeenCalledWith(
      '/api/translate',
      expect.objectContaining({
        body: expect.stringContaining('"mode":"save-item"'),
      })
    )
  })

  it('searches similar entries by the source name from a name row', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'Marie',
        zh: '玛丽',
        meta: { category: 'actor', label: '角色名' },
      },
      {
        id: '2',
        src: 'こんにちは',
        zh: '你好',
        meta: { category: 'dialogue', label: '对话' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    const findSimilarButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === '相关')
    expect(findSimilarButtons).toHaveLength(1)

    await act(async () => {
      findSimilarButtons[0]?.click()
    })

    expect(mockRouter.push).toHaveBeenCalledWith('/translate/list?q=Marie')
  })

  it('reads and applies initial filter criteria from URL search parameters', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'Hello dialogue',
        zh: '你好对话',
        meta: { category: 'dialogue', label: '对话', context: 'Scene1' },
      },
      {
        id: '2',
        src: 'Potion item',
        zh: '',
        meta: { category: 'item', label: '物品', context: 'Bag' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    expect(container.textContent).toContain('Hello dialogue')
    expect(container.textContent).toContain('Potion item')
  })

  it('triggers batch save with confirmation when pagination save button is clicked', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'こんにちは',
        zh: '你好',
        meta: { category: 'dialogue', label: '对话' },
      },
      {
        id: '2',
        src: 'さようなら',
        zh: '再见',
        meta: { category: 'dialogue', label: '对话' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      if (body.mode === 'save-item') {
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    const batchSaveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '保存')
    expect(batchSaveBtn).toBeDefined()

    await act(async () => {
      batchSaveBtn?.click()
    })

    // Confirm dialog was triggered
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('确认保存当前页所有译文'),
      })
    )

    // Save calls were made for the items
    expect(mockTranslationFetch).toHaveBeenCalledWith(
      '/api/translate',
      expect.objectContaining({
        body: expect.stringContaining('"text":"こんにちは"'),
      })
    )
    expect(mockTranslationFetch).toHaveBeenCalledWith(
      '/api/translate',
      expect.objectContaining({
        body: expect.stringContaining('"text":"さようなら"'),
      })
    )
  })

  it('triggers batch reset with confirmation when toolbar reset button is clicked', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'こんにちは',
        initialZh: '原句你好',
        zh: '已改你好',
        meta: { category: 'dialogue', label: '对话' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    const batchResetBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '重置')
    expect(batchResetBtn).toBeDefined()

    await act(async () => {
      batchResetBtn?.click()
    })

    // Confirm dialog was triggered
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('确认重置当前页所有译文'),
      })
    )

    // Item reverted back to initialZh
    expect(mockItems[0].zh).toBe('原句你好')
  })

  it('enables the save button immediately when typing translation into editor', async () => {
    const mockItems = [
      {
        id: '1',
        src: '薬草',
        zh: '',
        meta: { category: 'item', label: '物品' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '保存译文至游戏')
    expect(saveBtn).toBeDefined()
    expect(saveBtn?.disabled).toBe(true)

    // Find translated editor input and type into it
    const editorInputs = Array.from(container.querySelectorAll('input'))
    const zhInput = editorInputs.find((input) => input.closest('[aria-label="条目 #1 译文"]'))
    expect(zhInput).toBeDefined()

    await act(async () => {
      const event = new Event('input', { bubbles: true })
      Object.defineProperty(event, 'target', { value: { value: '药草' } })
      zhInput?.dispatchEvent(event)
      // Also trigger change handler directly as mock
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      nativeInputValueSetter?.call(zhInput, '药草')
      zhInput?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(saveBtn?.disabled).toBe(false)

    await act(async () => {
      saveBtn?.click()
    })
    expect(mockTranslationFetch).toHaveBeenCalledWith(
      '/api/translate',
      expect.objectContaining({
        body: expect.stringContaining('"mode":"save-item"'),
      })
    )
  })
  it('opens apple offline pack modal with required languages when apple translation reports not_installed', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'こんにちは',
        zh: '',
        meta: { category: 'dialogue', label: '对话' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      if (body.force) {
        return {
          ok: false,
          json: async () => ({
            ok: false,
            items: [
              {
                error:
                  'apple: Apple offline language pack not installed. Please download the language pack in macOS System Settings -> General -> Language & Region -> Translation Languages.',
              },
            ],
          }),
        }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    // Find row translate button
    const transBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('翻译'))
    expect(transBtn).toBeDefined()

    await act(async () => {
      transBtn?.click()
    })

    // Confirm modal popped up
    const modal = document.querySelector('[data-testid="mock-modal"]')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('需要安装 Apple 离线翻译语言包')
    expect(modal?.textContent).toContain('本次翻译需要下载的语言：')
  })

  it('searches items interchangeably by translation, key, or original text', async () => {
    const mockItems = [
      {
        id: 'row_101',
        src: 'Thunder Sword',
        zh: '雷鸣之剑',
        meta: { category: 'weapon', label: '武器', localesKey: 'weapon.thunder_sword' },
      },
      {
        id: 'row_102',
        src: 'Fire Staff',
        zh: '烈焰法杖',
        meta: { category: 'weapon', label: '武器', localesKey: 'weapon.fire_staff' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    // 1. Search by translation (zh)
    mockSearchParams = new URLSearchParams({ q: '雷鸣' })
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })
    await act(async () => {})

    expect(container.textContent).toContain('Thunder Sword')
    expect(container.querySelector('input[value="雷鸣之剑"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Fire Staff')

    // 2. Search by key (localesKey)
    mockSearchParams = new URLSearchParams({ q: 'fire_staff' })
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })
    await act(async () => {})
    expect(container.textContent).toContain('Fire Staff')
    expect(container.querySelector('input[value="烈焰法杖"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Thunder Sword')
  })
  it('renders translation source badges and protects manual translations during page translate', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'Hello manual',
        zh: '你好手动',
        engine: 'manual',
        meta: { category: 'dialogue', label: '对话' },
      },
      {
        id: '2',
        src: 'Hello machine',
        zh: '你好机器',
        engine: 'google',
        meta: { category: 'dialogue', label: '对话' },
      },
      {
        id: '3',
        src: 'Untranslated item',
        zh: '',
        meta: { category: 'item', label: '物品' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      if (body.texts) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            items: body.texts.map((src: string) => ({ src, zh: `译文:${src}` })),
          }),
        }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    // 1. Verify badges rendered
    expect(container.textContent).toContain('手动')
    expect(container.textContent).toContain('平台')

    // 2. Trigger page translate
    const pageTransBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '翻译本页')
    expect(pageTransBtn).toBeDefined()

    await act(async () => {
      pageTransBtn?.click()
    })

    // 3. Verify manual translation was NOT sent to API
    const transCalls = mockTranslationFetch.mock.calls.map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null)).filter((b) => b && Array.isArray(b.texts))

    expect(transCalls.length).toBeGreaterThan(0)
    const allSentTexts = transCalls.flatMap((b) => b.texts)

    expect(allSentTexts).not.toContain('Hello manual')
    expect(allSentTexts).toContain('Hello machine')
    expect(allSentTexts).toContain('Untranslated item')

    // Manual item remained intact
    expect(mockItems[0].zh).toBe('你好手动')
    expect(mockNotify.success).toHaveBeenCalledWith(expect.stringContaining('已跳过 1 条手动翻译'))
  })

  it('notifies and skips API calls when all items on page are manual translations', async () => {
    const mockItems = [
      {
        id: '1',
        src: 'Item 1',
        zh: '人工条目1',
        engine: 'manual',
        meta: { category: 'dialogue', label: '对话' },
      },
      {
        id: '2',
        src: 'Item 2',
        zh: '人工条目2',
        engine: 'manual',
        meta: { category: 'dialogue', label: '对话' },
      },
    ]

    mockTranslationFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.mode === 'extract-items') {
        return { ok: true, json: async () => ({ ok: true, items: mockItems }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <PanelHeadEndProvider>
            <PanelHeadEndHost />
            <TranslateListContent />
          </PanelHeadEndProvider>
        </LocaleProvider>
      )
    })

    const pageTransBtn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '翻译本页')
    expect(pageTransBtn).toBeDefined()

    await act(async () => {
      pageTransBtn?.click()
    })

    const transCalls = mockTranslationFetch.mock.calls
      .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))
      .filter((b) => b && (Array.isArray(b.texts) || b.mode === 'cache'))

    expect(transCalls).toHaveLength(0)
    expect(mockNotify.info).toHaveBeenCalledWith(expect.stringContaining('手动翻译（权重最高），已受保护跳过'))
  })
})
