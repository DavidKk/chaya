/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { RUN_FLAG_KEYS } from '@/components/game-edit/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { FloatingBallSettingsView } from '@/components/settings/FloatingBallSettingsView'
import { DEFAULT_TOOL_SETTINGS, normalizeToolSettings, type ToolSettings } from '@/lib/game-agent/tool-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
let stored: ToolSettings
const request: GameAgentRequest = async (_path, init) => {
  if (init?.method === 'PUT') stored = normalizeToolSettings({ ...stored, ...JSON.parse(String(init.body)).patch })
  return { ok: true, json: async () => ({ settings: stored }) } as Response
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
  stored = { ...DEFAULT_TOOL_SETTINGS, miniMapEnabled: true }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function render(using: GameAgentRequest = request) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <FloatingBallSettingsView request={using} />
      </LocaleProvider>
    )
  )
}

it('saves enable, reordering and removal while preserving other panel settings', async () => {
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
  expect(stored.floatingBallEnabled).toBe(true)
  const list = () => host.querySelector('ol')!
  const second = list().children[1] as HTMLElement
  await act(async () => second.querySelector<HTMLButtonElement>('button')!.click())
  expect(stored.floatingBallShortcuts.slice(0, 2)).toEqual(['action:scene:item', 'action:battle:victory'])
  const first = list().children[0] as HTMLElement
  await act(async () => first.querySelectorAll<HTMLButtonElement>('button')[2]!.click())
  expect(stored.floatingBallShortcuts).not.toContain('action:scene:item')
  expect(stored.miniMapEnabled).toBe(true)
  expect(button('添加快捷功能')).toBeTruthy()
})

it('locks configuration when the local service is unavailable', async () => {
  await render(async () => ({ ok: false, status: 404 }) as Response)
  expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
  expect(host.textContent).toContain('仅在 Chaya App 或本机服务中可用')
})

it('limits the ring to eight bindings while keeping its enable switch available', async () => {
  stored = normalizeToolSettings({ ...stored, floatingBallShortcuts: RUN_FLAG_KEYS.map((id) => `flag:${id}`) })
  await render()
  expect(button('添加快捷功能').disabled).toBe(true)
  expect(host.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(false)
  expect(host.querySelectorAll('ol > li')).toHaveLength(8)
  expect(host.textContent).toContain('最多绑定 8 个功能')
})
