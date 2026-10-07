/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { MiniPanelsPage } from '@/components/game-tools/MiniPanelsPage'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { DEFAULT_TOOL_SETTINGS, type ToolSettings } from '@/lib/game-agent/tool-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let saved: ToolSettings
let puts: ToolSettings[]

function serverRequest(status = 200): GameAgentRequest {
  return async (_path, init) => {
    if (status !== 200) return { ok: false, status } as Response
    if (init?.method === 'PUT') {
      saved = JSON.parse(String(init.body)).settings
      puts.push(saved)
    }
    return { ok: true, json: async () => ({ settings: saved }) } as Response
  }
}

async function renderPage(request: GameAgentRequest) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <MiniPanelsPage request={request} />
        </NotificationProvider>
      </LocaleProvider>
    )
  )
}

const switchFor = (label: string) => document.querySelector(`:is([role="switch"], [role="checkbox"])[aria-label="${label}"]`) as HTMLButtonElement

beforeAll(() => {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

beforeEach(() => {
  localStorage.clear()
  saved = { ...DEFAULT_TOOL_SETTINGS }
  puts = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

it('hides and shows every button at once from the card switch', async () => {
  await renderPage(serverRequest())
  expect(switchFor('全部关闭').getAttribute('aria-checked')).toBe('true')
  await act(async () => switchFor('全部关闭').click())
  expect(saved.panelDockHiddenItems).toEqual(['miniMap', 'companion', 'autoSaves', 'quickSaves', 'closeAll'])
  expect(switchFor('全部开启').getAttribute('aria-checked')).toBe('false')
  await act(async () => switchFor('全部开启').click())
  expect(saved.panelDockHiddenItems).toEqual([])
})

it('shows the card switch half on while only some buttons are shown', async () => {
  saved = { ...DEFAULT_TOOL_SETTINGS, panelDockHiddenItems: ['closeAll'] }
  await renderPage(serverRequest())
  expect(switchFor('全部开启').getAttribute('aria-checked')).toBe('mixed')
  expect(switchFor('全部开启').getAttribute('role')).toBe('checkbox')
  await act(async () => switchFor('全部开启').click())
  expect(saved.panelDockHiddenItems).toEqual([])
})

it('keeps both changes when two rows are switched off quickly', async () => {
  await renderPage(serverRequest())
  await act(async () => {
    switchFor('在管理面板中显示「迷你地图」').click()
    switchFor('在管理面板中显示「关闭全部」').click()
  })
  expect(puts).toHaveLength(2)
  expect(saved.panelDockHiddenItems).toEqual(['miniMap', 'closeAll'])
  expect(switchFor('在管理面板中显示「迷你地图」').getAttribute('aria-checked')).toBe('false')
})

it('turns the manager on', async () => {
  await renderPage(serverRequest())
  await act(async () => switchFor('开启迷你面板管理').click())
  expect(saved.panelDockEnabled).toBe(true)
})

it('locks every control when tool settings are not available', async () => {
  await renderPage(serverRequest(404))
  expect(document.body.textContent).toContain('仅在 Chaya App 或本机服务中可用')
  expect(switchFor('开启迷你面板管理').disabled).toBe(true)
  expect(switchFor('在管理面板中显示「旅伴」').disabled).toBe(true)
  expect(switchFor('全部关闭').disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
