/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DashboardSettings } from '@/components/DashboardSettings'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

describe('DashboardSettings open path buttons', () => {
  let host: HTMLDivElement
  let root: Root
  const onOpenPath = jest.fn()
  const onCopyPath = jest.fn()
  const onChooseGame = jest.fn()
  const onChooseShell = jest.fn()

  beforeEach(() => {
    onOpenPath.mockClear()
    onCopyPath.mockClear()
    onChooseGame.mockClear()
    onChooseShell.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('renders open buttons for game path and shell source with consistent icon button style', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <DashboardSettings
            busy={false}
            bundled={false}
            remote={false}
            browserMode={false}
            gameRoot="/path/to/my-game"
            shellSource="/path/to/my-shell"
            win={null}
            onGameRootChange={() => {}}
            onShellSourceChange={() => {}}
            onBindGame={() => {}}
            onBindShell={() => {}}
            onChooseGame={onChooseGame}
            onChooseShell={onChooseShell}
            onCopyPath={onCopyPath}
            onOpenPath={onOpenPath}
            onPatchWin={() => {}}
            onPatchWinSize={() => {}}
            boundGameRoot="/path/to/my-game"
            boundShellSource="/path/to/my-shell"
          />
        </LocaleProvider>
      )
    })

    const openGameBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开路径"]')
    const openShellBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开壳源"]')

    expect(openGameBtn).not.toBeNull()
    expect(openShellBtn).not.toBeNull()

    // Both are icon buttons
    expect(openGameBtn?.getAttribute('data-size')).toBe('icon')
    expect(openShellBtn?.getAttribute('data-size')).toBe('icon')
    expect(openGameBtn?.disabled).toBe(false)
    expect(openShellBtn?.disabled).toBe(false)

    // Click game open button
    await act(async () => {
      openGameBtn?.click()
    })
    expect(onOpenPath).toHaveBeenCalledWith('/path/to/my-game')

    // Click shell open button
    await act(async () => {
      openShellBtn?.click()
    })
    expect(onOpenPath).toHaveBeenCalledWith('/path/to/my-shell')
  })

  it('allows opening active shell when shellSource is empty but activeShellPath is set', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <DashboardSettings
            busy={false}
            bundled={false}
            remote={false}
            browserMode={false}
            gameRoot="/path/to/my-game"
            shellSource=""
            activeShellPath="/data/shell/nwjs.app"
            win={null}
            onGameRootChange={() => {}}
            onShellSourceChange={() => {}}
            onBindGame={() => {}}
            onBindShell={() => {}}
            onChooseGame={onChooseGame}
            onChooseShell={onChooseShell}
            onCopyPath={onCopyPath}
            onOpenPath={onOpenPath}
            onPatchWin={() => {}}
            onPatchWinSize={() => {}}
            boundGameRoot="/path/to/my-game"
            boundShellSource=""
          />
        </LocaleProvider>
      )
    })

    const openShellBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开壳源"]')
    expect(openShellBtn).not.toBeNull()
    expect(openShellBtn?.disabled).toBe(false)

    await act(async () => {
      openShellBtn?.click()
    })
    expect(onOpenPath).toHaveBeenCalledWith('/data/shell/nwjs.app')
  })

  it('disables open buttons when path is empty and no active shell exists', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <DashboardSettings
            busy={false}
            bundled={false}
            remote={false}
            browserMode={false}
            gameRoot=""
            shellSource=""
            win={null}
            onGameRootChange={() => {}}
            onShellSourceChange={() => {}}
            onBindGame={() => {}}
            onBindShell={() => {}}
            onChooseGame={onChooseGame}
            onChooseShell={onChooseShell}
            onCopyPath={onCopyPath}
            onOpenPath={onOpenPath}
            onPatchWin={() => {}}
            onPatchWinSize={() => {}}
            boundGameRoot=""
            boundShellSource=""
          />
        </LocaleProvider>
      )
    })

    const openGameBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开路径"]')
    const openShellBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开壳源"]')

    expect(openGameBtn?.disabled).toBe(true)
    expect(openShellBtn?.disabled).toBe(true)
  })

  it('omits open buttons in browserMode', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <DashboardSettings
            busy={false}
            bundled={false}
            remote={false}
            browserMode={true}
            browserFolder="MyGame"
            gameRoot=""
            shellSource=""
            win={null}
            onGameRootChange={() => {}}
            onShellSourceChange={() => {}}
            onBindGame={() => {}}
            onBindShell={() => {}}
            onChooseGame={onChooseGame}
            onChooseShell={onChooseShell}
            onCopyPath={onCopyPath}
            onOpenPath={onOpenPath}
            onPatchWin={() => {}}
            onPatchWinSize={() => {}}
            boundGameRoot=""
            boundShellSource=""
          />
        </LocaleProvider>
      )
    })

    const openGameBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开路径"]')
    const openShellBtn = host.querySelector<HTMLButtonElement>('button[aria-label="打开壳源"]')

    expect(openGameBtn).toBeNull()
    expect(openShellBtn).toBeNull()
  })
})
