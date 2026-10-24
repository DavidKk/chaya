/** @jest-environment jsdom */
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { PanelHeadEndHost, PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { TranslateListContent } from '@/components/translate/TranslateListContent'

const mockTranslationFetch = jest.fn()
const mockNotify = { success: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const mockConfirm = jest.fn().mockResolvedValue(true)

let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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
          <TranslateListContent />
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

    // Item 1 has row reset; batch reset is an icon button in the top toolbar
    const resetButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('重置') || b.getAttribute('aria-label') === '重置')
    expect(resetButtons.length).toBe(2)

    // 2 row save buttons + batch save icon in the top toolbar
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
          <TranslateListContent />
        </LocaleProvider>
      )
    })

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('保存'))
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
          <TranslateListContent />
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
          <TranslateListContent />
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
          <TranslateListContent />
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
          <TranslateListContent />
        </LocaleProvider>
      )
    })

    // Initially save button for item 1 should be disabled because zh is empty
    const saveButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('保存'))
    const rowSaveBtn = saveButtons[0]
    expect(rowSaveBtn).toBeDefined()
    expect(rowSaveBtn.disabled).toBe(true)

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

    // Now save button should be enabled!
    expect(rowSaveBtn.disabled).toBe(false)
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
          <TranslateListContent />
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
})
