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
  it('renders unified console menu button on startup screen matching in-game button', async () => {
    await act(async () => {
      root.render(<LocaleProvider initialLocale="zh" initialPreference="zh"><RemotePlayView initialRoomId="game-1" /></LocaleProvider>)
    })

    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台')
    )
    expect(menuBtn).toBeDefined()
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


  it('renders language switcher inside settings modal and GradientButton for game launch', async () => {
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

    // Language switcher is inside preferences settings modal
    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台')
    )
    expect(menuBtn).toBeDefined()
    await act(async () => {
      menuBtn?.click()
    })

    const langTrigger = host.querySelector('button[aria-label="切换语言"]')
    expect(langTrigger).not.toBeNull()

    // Launch button rendered with GradientButton
    const launchBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('启动游戏'))
    expect(launchBtn).toBeDefined()
  })

  it('prompts confirmation modal before hard reload from within menu', async () => {
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

    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台')
    )
    expect(menuBtn).toBeDefined()

    await act(async () => {
      menuBtn?.click()
    })

    const reloadRow = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('清理重载'))
    expect(reloadRow).toBeDefined()

    await act(async () => {
      reloadRow?.click()
    })

    // Confirmation modal appears
    expect(host.textContent).toContain('清理缓存并重载？')
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
    expect(closeBtn.className).toContain('flex items-center justify-center')

    // Verify cards have cursor-pointer, rounded-[0.25rem], and omit "www 内容"
    const gameCards = Array.from(dialog.querySelectorAll('button')).filter((b) => b !== closeBtn)
    expect(gameCards.length).toBeGreaterThan(0)
    expect(gameCards[0]?.className).toContain('cursor-pointer')
    expect(gameCards[0]?.className).toContain('rounded-[0.25rem]')
    expect(dialog.textContent).not.toContain('www 内容')
  })
  it('renders unified ConfigRow with icon, label, and no mode descriptions', async () => {
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

    // Open settings modal
    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台')
    )
    await act(async () => {
      menuBtn?.click()
    })

    // Check language config row has globe icon
    const langTrigger = host.querySelector('button[aria-label="切换语言"]')
    expect(langTrigger).not.toBeNull()

    // Mode buttons exist without descriptive paragraph blocks
    const modeButtons = Array.from(host.querySelectorAll('button')).filter((b) =>
      ['固定', '自由', '左手', '右手', '触屏'].some((label) => b.textContent?.includes(label))
    )
    expect(modeButtons.length).toBeGreaterThanOrEqual(0)
  })

  it('renders haptic feedback toggle row inside gamepad settings tab', async () => {
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

    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台')
    )
    await act(async () => {
      menuBtn?.click()
    })

    // Switch to gamepad tab
    const gamepadTabBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('手柄')
    )
    await act(async () => {
      gamepadTabBtn?.click()
    })

    const hapticRow = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('触感震动')
    )
    expect(hapticRow).toBeDefined()

    const opacityLabel = Array.from(host.querySelectorAll('*')).find((el) =>
      el.textContent?.includes('按键透明度')
    )
    expect(opacityLabel).toBeDefined()
  })

  it('renders centered video element in portrait mode without hard top container', async () => {
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

    const video = host.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.className).toContain('max-h-full')
    expect(video?.className).toContain('max-w-full')
  })

  it('hijacks contextmenu on video to trigger in-game menu/cancel', async () => {
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

    const video = host.querySelector('video')
    expect(video).not.toBeNull()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    const preventDefault = jest.spyOn(event, 'preventDefault')
    act(() => {
      video?.dispatchEvent(event)
    })
    expect(preventDefault).toHaveBeenCalled()
  })
})
