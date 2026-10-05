/** @jest-environment jsdom */
import { act, type ComponentProps, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AUTO_UPDATE_PLUGINS_KEY, useAutoUpdatePlugins } from '@/components/dashboard/useAutoUpdatePlugins'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

const mockNotify = { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))

type Opts = Parameters<typeof useAutoUpdatePlugins>[0]
let container: HTMLDivElement
let root: Root
const probe: { api?: ReturnType<typeof useAutoUpdatePlugins> } = {}

function Probe(props: Opts) {
  const api = useAutoUpdatePlugins(props)
  useEffect(() => {
    probe.api = api
  })
  return null
}

const tick = () => act(async () => {})

async function render(overrides: Partial<Opts> = {}): Promise<Opts> {
  const props: Opts = { supported: true, outdated: true, gameKey: '/games/a', busy: false, gameOnline: false, update: jest.fn(async () => true), ...overrides }
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <Probe {...(props as ComponentProps<typeof Probe>)} />
      </LocaleProvider>
    )
  )
  await tick()
  return props
}

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }))

beforeEach(() => {
  window.localStorage.clear()
  Object.values(mockNotify).forEach((fn) => fn.mockClear())
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAutoUpdatePlugins', () => {
  it('updates once by default when outdated', async () => {
    const props = await render()
    expect(props.update).toHaveBeenCalledTimes(1)
    expect(mockNotify.success).toHaveBeenCalledWith('插件已自动更新')
    await render({ update: props.update, busy: true })
    await render({ update: props.update })
    expect(props.update).toHaveBeenCalledTimes(1)
  })

  it('never fires when the stored preference is off', async () => {
    window.localStorage.setItem(AUTO_UPDATE_PLUGINS_KEY, '0')
    const props = await render()
    expect(props.update).not.toHaveBeenCalled()
    expect(probe.api?.enabled).toBe(false)
  })

  it('stays manual when unsupported, busy or up to date', async () => {
    for (const overrides of [{ supported: false }, { busy: true }, { outdated: false }]) {
      const props = await render(overrides)
      expect(props.update).not.toHaveBeenCalled()
    }
    expect(probe.api?.supported).toBe(true)
  })

  it('retries after a skipped attempt, not after a failed one', async () => {
    const skipped = jest.fn(async () => null)
    await render({ update: skipped })
    await render({ update: skipped, busy: true })
    await render({ update: skipped })
    expect(skipped).toHaveBeenCalledTimes(2)

    const failed = jest.fn(async () => false)
    await render({ gameKey: '/games/b', update: failed })
    await render({ gameKey: '/games/b', update: failed, busy: true })
    await render({ gameKey: '/games/b', update: failed })
    expect(failed).toHaveBeenCalledTimes(1)
    expect(mockNotify.success).not.toHaveBeenCalled()
  })

  it('persists the switch and re-arms attempts', async () => {
    const failed = jest.fn(async () => false)
    await render({ update: failed })
    act(() => probe.api!.onChange(false))
    expect(window.localStorage.getItem(AUTO_UPDATE_PLUGINS_KEY)).toBe('0')
    act(() => probe.api!.onChange(true))
    await tick()
    expect(failed).toHaveBeenCalledTimes(2)
  })

  it('hints a restart while the game is running', async () => {
    await render({ gameOnline: true })
    expect(mockNotify.success).toHaveBeenCalledWith('插件已自动更新 · 重启游戏生效')
  })
})
