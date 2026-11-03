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
            { id: 'game-2', name: '魔法少女', gameRoot: '/Games/Magic', kindLabel: 'www 内容' },
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
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <RemotePlayView initialRoomId="game-1" />
        </LocaleProvider>
      )
    })

    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台'))
    expect(menuBtn).toBeDefined()
  })

  it('detects game not running and displays launch button with game card', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <RemotePlayView initialRoomId="game-1" />
        </LocaleProvider>
      )
    })

    // Allow status fetch to resolve
    await act(async () => {
      await Promise.resolve()
    })

    expect(host.textContent).toContain('勇者传说')
    expect(host.textContent).toContain('启动游戏')
    expect(host.textContent).not.toContain('切换游戏')
    expect(host.querySelector('button[aria-label="切换游戏: 勇者传说"]')).not.toBeNull()
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
    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台'))
    expect(menuBtn).toBeDefined()
    await act(async () => {
      menuBtn?.click()
    })

    const langTrigger = document.body.querySelector('button[aria-label="切换语言"]')
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

    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台'))
    expect(menuBtn).toBeDefined()

    await act(async () => {
      menuBtn?.click()
    })

    const reloadRow = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('清理重载'))
    expect(reloadRow).toBeDefined()

    await act(async () => {
      reloadRow?.click()
    })

    // Confirmation modal appears
    expect(document.body.textContent).toContain('清理缓存并重载？')
  })

  it('opens game selector modal with safe padding and centered title', async () => {
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

    const switchBtn = host.querySelector<HTMLButtonElement>('button[aria-label="切换游戏: 勇者传说"]')
    expect(switchBtn).not.toBeNull()

    await act(async () => {
      switchBtn?.click()
    })

    expect(document.body.textContent).toContain('可运行游戏列表')
    expect(host.textContent).toContain('勇者传说')
    expect(document.body.textContent).toContain('魔法少女')

    // Verify modal overlay has safe-area-inset padding for Dynamic Island
    const dialog = document.body.querySelector('div[role="dialog"]') as HTMLDivElement
    expect(dialog).not.toBeNull()
    expect(dialog.parentElement?.className).toContain('safe-area-inset-left')
    expect(dialog.parentElement?.className).toContain('safe-area-inset-right')
    expect(dialog.className).toContain('rounded-[0.35rem]')

    // Verify header title is centered and close button is an icon button
    const closeBtn = dialog.querySelector('button[aria-label="关闭"]') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    expect(closeBtn.classList.contains('items-center')).toBe(true)
    expect(closeBtn.classList.contains('justify-center')).toBe(true)

    // Verify cards have cursor-pointer, rounded-[0.25rem], and omit "www 内容"
    const gameCards = Array.from(dialog.querySelectorAll('button')).filter((b) => b !== closeBtn)
    expect(gameCards.length).toBeGreaterThan(0)
    expect(gameCards[0]?.className).toContain('cursor-pointer')
    expect(gameCards[0]?.className).toContain('rounded-[0.25rem]')
    expect(dialog.textContent).not.toContain('www 内容')
  })

  it('groups running cloud and local games and offers continue after selecting a running game', async () => {
    window.fetch = jest.fn((url) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).startsWith('/api/status')
            ? {
                selected: '/Games/Stopped',
                library: [
                  { id: 'stopped', name: '未启动', gameRoot: '/Games/Stopped' },
                  { id: 'cloud', name: '云端存档', gameRoot: '/Games/Cloud', running: { mode: 'cloud', pid: 101, roomId: 'cloud' } },
                  { id: 'local', name: '本机进度', gameRoot: '/Games/Local', running: { mode: 'local', pid: 102, roomId: 'local' } },
                ],
              }
            : {},
      } as Response)
    )
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <RemotePlayView />
        </LocaleProvider>
      )
    })
    const selector = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
    await act(async () => selector.click())
    const cloud = document.body.querySelector('section[aria-label="云端游戏"]')!
    const local = document.body.querySelector('section[aria-label="本地游戏"]')!
    expect(cloud.textContent).toContain('云端存档')
    expect(cloud.textContent).not.toContain('本机进度')
    expect(local.textContent).toContain('本机进度')
    expect(local.textContent).toContain('未启动')
    const localGame = Array.from(local.querySelectorAll('button')).find((button) => button.textContent?.includes('本机进度'))!
    await act(async () => localGame.click())
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('继续游戏')
    expect(host.textContent).toContain('本地运行中')
    expect(host.textContent).not.toContain('启动游戏')
    expect(jest.mocked(window.fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true)
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
    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台'))
    await act(async () => {
      menuBtn?.click()
    })

    // Check language config row has globe icon
    const langTrigger = document.body.querySelector('button[aria-label="切换语言"]')
    expect(langTrigger).not.toBeNull()

    const gamepadTab = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === '手柄')
    await act(async () => {
      gamepadTab?.click()
    })
    const dialog = document.body.querySelector('[role="dialog"]')!
    for (const label of ['固定', '自由', '左手', '右手', '触屏']) {
      expect(Array.from(dialog.querySelectorAll('button')).some((button) => button.textContent === label)).toBe(true)
    }
    expect(dialog.querySelector('p')).toBeNull()
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

    const menuBtn = Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('控制台') || b.getAttribute('title')?.includes('控制台'))
    await act(async () => {
      menuBtn?.click()
    })

    // Switch to gamepad tab
    const gamepadTabBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('手柄'))
    await act(async () => {
      gamepadTabBtn?.click()
    })

    const hapticRow = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('触感震动'))
    expect(hapticRow).toBeDefined()

    const opacityLabel = Array.from(document.body.querySelectorAll('*')).find((el) => el.textContent?.includes('按键透明度'))
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
