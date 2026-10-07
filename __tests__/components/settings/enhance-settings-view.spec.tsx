/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { EnhanceSettingsView } from '@/components/settings/EnhanceSettingsView'
import { DEFAULT_TOOL_SETTINGS, normalizeToolSettings } from '@/lib/game-agent/tool-settings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

it('defaults smart pathfinding to on, including settings saved before it existed', () => {
  expect(DEFAULT_TOOL_SETTINGS.smartPathEnabled).toBe(true)
  expect(normalizeToolSettings({ miniMapEnabled: true }).smartPathEnabled).toBe(true)
  expect(normalizeToolSettings({ smartPathEnabled: false }).smartPathEnabled).toBe(false)
})

it('shows the smart pathfinding switch and saves it to tool settings', async () => {
  let stored = { ...DEFAULT_TOOL_SETTINGS }
  const puts: unknown[] = []
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      stored = (JSON.parse(String(init.body)) as { settings: typeof stored }).settings
      puts.push(stored.smartPathEnabled)
    }
    const settings = stored
    return { ok: true, json: async () => ({ settings }) } as Response
  })
  await act(async () => root.render(<EnhanceSettingsView request={request} />))
  const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')!
  expect(host.textContent).toContain('Smart pathfinding')
  expect(toggle.getAttribute('aria-checked')).toBe('true')

  await act(async () => {
    toggle.click()
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(puts).toEqual([false])
  expect(host.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('false')
})
