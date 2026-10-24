/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DashboardGameActions } from '@/components/dashboard/DashboardGameActions'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk/Button'

jest.mock('@/components/notification/useNotification', () => ({
  useNotification: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }),
}))

describe('Button styles and sizes', () => {
  let host: HTMLDivElement
  let root: Root

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
    })
  })

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders solid gradient buttons by default for colored variants', async () => {
    await act(async () =>
      root.render(
        <>
          <Button variant="ok">开始游戏</Button>
          <Button variant="fail">清除插件</Button>
          <Button variant="accent">主强调</Button>
          <Button variant="warn">警告</Button>
        </>
      )
    )

    const buttons = host.querySelectorAll('button')
    const [btnOk, btnFail, btnAccent, btnWarn] = [...buttons]

    expect(btnOk?.className).toContain('linear-gradient')
    expect(btnOk?.className).toContain('text-[#ecfdf5]')
    expect(btnOk?.getAttribute('data-sheen')).toBe('true')

    expect(btnFail?.className).toContain('linear-gradient')
    expect(btnFail?.className).toContain('text-[#fef2f2]')
    expect(btnFail?.getAttribute('data-sheen')).toBe('true')

    expect(btnAccent?.className).toContain('linear-gradient')
    expect(btnAccent?.className).toContain('text-accent-ink')
    expect(btnAccent?.getAttribute('data-sheen')).toBe('true')

    expect(btnWarn?.className).toContain('linear-gradient')
    expect(btnWarn?.className).toContain('text-white')
    expect(btnWarn?.getAttribute('data-sheen')).toBe('true')
  })

  it('renders outline/tinted buttons when explicitly requested via outline prop or variant', async () => {
    await act(async () =>
      root.render(
        <>
          <Button variant="ok" outline>
            次级OK
          </Button>
          <Button variant="outline-fail">次级FAIL</Button>
        </>
      )
    )

    const [btnOk, btnFail] = [...host.querySelectorAll('button')]

    expect(btnOk?.className).not.toContain('linear-gradient')
    expect(btnOk?.className).toContain('text-ok')
    expect(btnOk?.className).toContain('var(--ok)_10%')
    expect(btnOk?.getAttribute('data-sheen')).toBeNull()

    expect(btnFail?.className).not.toContain('linear-gradient')
    expect(btnFail?.className).toContain('text-fail')
    expect(btnFail?.className).toContain('var(--fail)_10%')
    expect(btnFail?.getAttribute('data-sheen')).toBeNull()
  })

  it('enforces gradient style for large buttons (size="lg" and size="gate")', async () => {
    await act(async () =>
      root.render(
        <>
          <Button size="lg" variant="ok" outline>
            大按钮OK
          </Button>
          <Button size="gate" variant="accent" outline>
            门禁大按钮
          </Button>
        </>
      )
    )

    const [btnLg, btnGate] = [...host.querySelectorAll('button')]

    expect(btnLg?.getAttribute('data-size')).toBe('lg')
    expect(btnLg?.className).toContain('h-11')
    expect(btnLg?.className).toContain('linear-gradient')
    expect(btnLg?.getAttribute('data-sheen')).toBe('true')

    expect(btnGate?.getAttribute('data-size')).toBe('gate')
    expect(btnGate?.className).toContain('linear-gradient')
    expect(btnGate?.getAttribute('data-sheen')).toBe('true')
  })

  it('renders DashboardGameActions buttons as large gradient buttons', async () => {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="en" initialPreference="en">
          <DashboardGameActions
            busy={false}
            launch={{ online: false, pending: false, enabled: true, label: 'Start', onStart: async () => {}, onQuit: async () => {} }}
            plugins={{ state: 'ready', onInstall: async () => {}, onClear: async () => {} }}
            shell={{
              canInstall: false,
              canUninstall: false,
              canFetch: false,
              hasShell: true,
              hasSource: true,
              onInstall: async () => {},
              onFetchLatest: async () => {},
              onUninstall: async () => {},
            }}
          />
        </LocaleProvider>
      )
    )

    const buttons = [...host.querySelectorAll('button')]
    const startBtn = buttons.find((b) => b.textContent?.includes('Start'))
    const clearBtn = buttons.find((b) => b.textContent?.includes('Clear'))

    expect(startBtn?.getAttribute('data-size')).toBe('lg')
    expect(startBtn?.getAttribute('data-sheen')).toBe('true')
    expect(startBtn?.className).toContain('linear-gradient')
    expect(startBtn?.className).toContain('text-[#ecfdf5]')

    expect(clearBtn?.getAttribute('data-size')).toBe('lg')
    expect(clearBtn?.getAttribute('data-sheen')).toBe('true')
    expect(clearBtn?.className).toContain('linear-gradient')
    expect(clearBtn?.className).toContain('text-[#fef2f2]')
  })
})
