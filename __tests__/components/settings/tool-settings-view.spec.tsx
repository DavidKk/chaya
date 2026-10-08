/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { ToolSettingsView } from '@/components/settings/ToolSettingsView'
import { DEFAULT_TOOL_SETTINGS } from '@/lib/game-agent/tool-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

async function renderView(page: 'minimap' | 'companion', request: GameAgentRequest) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <ToolSettingsView page={page} request={request} />
      </LocaleProvider>
    )
  )
}

const notFound: GameAgentRequest = async () => ({ ok: false, status: 404 }) as Response

it.each(['minimap', 'companion'] as const)('locks the %s controls and shows why outside the local service', async (page) => {
  await renderView(page, notFound)
  expect(host.textContent).toContain('仅在 Chaya App 或本机服务中可用')
  expect(host.querySelector<HTMLButtonElement>('button[role="switch"]')!.disabled).toBe(true)
  expect(host.querySelector('[role="alert"]')).toBeNull()
  if (page === 'companion') expect(host.querySelector<HTMLButtonElement>('#companion-character')!.disabled).toBe(true)
})

it('keeps the switch usable when tool settings load', async () => {
  const request: GameAgentRequest = async () => ({ ok: true, json: async () => ({ settings: { ...DEFAULT_TOOL_SETTINGS, companionEnabled: true } }) }) as Response
  await renderView('companion', request)
  expect(host.textContent).not.toContain('仅在 Chaya App 或本机服务中可用')
  expect(host.querySelector<HTMLButtonElement>('button[role="switch"]')!.disabled).toBe(false)
  expect(host.querySelector<HTMLButtonElement>('#companion-character')!.disabled).toBe(false)
})
