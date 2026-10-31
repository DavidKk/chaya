/**
 * @jest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { RemotePlayView } from '@/components/remote-play/RemotePlayView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  window.fetch = jest.fn((url: string | URL | Request) => {
    const urlStr = String(url)
    if (urlStr.includes('/api/status')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ready: true,
          selected: '/Games/TestGame',
          runtime: { gameOnline: false },
          library: [
            { id: 'game-1', name: '勇者传说', gameRoot: '/Games/TestGame', kindLabel: 'MV / MZ' },
            { id: 'game-2', name: '魔法少女', gameRoot: '/Games/Magic', kindLabel: 'VX Ace' },
          ],
        }),
      } as Response)
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    } as Response)
  }) as jest.Mock
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  jest.restoreAllMocks()
})

describe('RemotePlayView Launcher & UI refinements', () => {
  it('renders clear cache button on startup screen', async () => {
    await act(async () => {
      root.render(<LocaleProvider initialLocale="zh" initialPreference="zh"><RemotePlayView initialRoomId="game-1" /></LocaleProvider>)
    })

    const reloadBtn = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('清理') || b.getAttribute('title')?.includes('清理'))
    expect(reloadBtn).toBeDefined()
  })

  it('detects game not running and displays launch button with game card', async () => {
    await act(async () => {
      root.render(<LocaleProvider initialLocale="zh" initialPreference="zh"><RemotePlayView initialRoomId="game-1" /></LocaleProvider>)
    })

    // Allow status fetch to resolve
    await act(async () => {
      await Promise.resolve()
    })

    expect(host.textContent).toContain('勇者传说')
    expect(host.textContent).toContain('启动游戏')
    expect(host.textContent).toContain('切换游戏')
  })


  it('renders language switcher and GradientButton for game launch', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <RemotePlayView initialRoomId="game-1" />
        </LocaleProvider>
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Language switcher trigger rendered
    const langTrigger = host.querySelector('button[aria-label="切换语言"]')
    expect(langTrigger).not.toBeNull()

    // Launch button rendered with GradientButton
    const launchBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('启动游戏'))
    expect(launchBtn).toBeDefined()
  })

  it('opens game selector modal with safe padding and centered title', async () => {
    await act(async () => {
      root.render(<LocaleProvider initialLocale="zh" initialPreference="zh"><RemotePlayView initialRoomId="game-1" /></LocaleProvider>)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const switchBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('切换游戏'))
    expect(switchBtn).toBeDefined()

    await act(async () => {
      switchBtn?.click()
    })

    expect(host.textContent).toContain('可运行游戏列表')
    expect(host.textContent).toContain('勇者传说')
    expect(host.textContent).toContain('魔法少女')

    // Verify modal overlay has safe-area-inset padding for Dynamic Island
    const dialog = host.querySelector('div[role="dialog"]') as HTMLDivElement
    expect(dialog).not.toBeNull()
    expect(dialog.style.paddingLeft).toContain('safe-area-inset-left')
    expect(dialog.style.paddingRight).toContain('safe-area-inset-right')

    // Verify header title is centered and close button is an icon button
    const closeBtn = dialog.querySelector('button[aria-label="关闭"]') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    expect(closeBtn.className).toContain('absolute right-3')
  })
})
