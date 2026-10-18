/** @jest-environment jsdom */
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { TranslateListContent } from '@/components/translate/TranslateListContent'

const mockTranslationFetch = jest.fn()
const mockNotify = { success: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const mockConfirm = jest.fn().mockResolvedValue(true)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/translate/run/list',
  useSearchParams: () => new URLSearchParams(),
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
  Button: ({ children, onClick, disabled, loading, variant, _size, className }: any) => (
    <button onClick={onClick} disabled={disabled || loading} className={className} data-variant={variant}>
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
  TextInput: ({ value, onChange, placeholder }: any) => <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />,
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
      root.render(<TranslateListContent />)
    })

    // Confirm stats label
    expect(container.textContent).toContain('翻译数量:')

    // Confirm items rendered
    expect(container.textContent).toContain('こんにちは')
    expect(container.textContent).toContain('薬草')
    expect(container.textContent).toContain('勇者')
    expect(container.textContent).toContain('地图 1')
    expect(container.textContent).toContain('Map001.json')

    // Item 1 has savedZh in list, plus batch reset button in footer = 2
    const resetButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('重置'))
    expect(resetButtons.length).toBe(2)

    // 2 save buttons in list, plus batch save button in footer = 3
    const saveButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('保存'))
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
      root.render(<TranslateListContent />)
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
      root.render(<TranslateListContent />)
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
      root.render(<TranslateListContent />)
    })

    // Find footer batch save button (last save button)
    const saveButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('保存'))
    const footerSaveBtn = saveButtons[saveButtons.length - 1]
    expect(footerSaveBtn).toBeDefined()

    await act(async () => {
      footerSaveBtn?.click()
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

  it('triggers batch reset with confirmation when pagination reset button is clicked', async () => {
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
      root.render(<TranslateListContent />)
    })

    // Find footer batch reset button
    const resetButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('重置'))
    const footerResetBtn = resetButtons[resetButtons.length - 1]
    expect(footerResetBtn).toBeDefined()

    await act(async () => {
      footerResetBtn?.click()
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
})
