/** @jest-environment jsdom */
import { act, type ReactNode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import type { AgentSettings } from '@/components/settings/agent-types'
import { AgentSettingsView } from '@/components/settings/AgentSettingsView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

let host: HTMLDivElement
let root: Root
let settings: AgentSettings
let writes: AgentSettings[]

function Providers({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider initialLocale="zh" initialPreference="zh">
      <NotificationProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </NotificationProvider>
    </LocaleProvider>
  )
}

beforeEach(() => {
  settings = {
    version: 1,
    defaultProfileId: 'local',
    profiles: [
      {
        id: 'local',
        label: 'Local Ollama',
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        defaultModel: 'qwen3',
        temperature: 0.2,
        keepAlive: '10m',
      },
      {
        id: 'office',
        label: 'Office Ollama',
        provider: 'ollama',
        endpoint: 'http://10.0.0.2:11434',
        defaultModel: 'gemma3',
        temperature: 0.2,
        keepAlive: '10m',
      },
    ],
  }
  writes = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('lists multiple agents, opens a detail route, and saves edits through the shared adapter', async () => {
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      settings = (JSON.parse(String(init.body)) as { settings: AgentSettings }).settings
      settings = { ...settings, defaultProfileId: settings.profiles[0].id }
      writes.push(settings)
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ settings }),
    } as Response
  })

  function Harness() {
    const [agentId, setAgentId] = useState<string | undefined>()
    return (
      <Providers>
        <AgentSettingsView request={request} agentId={agentId} onNavigate={setAgentId} />
      </Providers>
    )
  }

  await act(async () => root.render(<Harness />))
  expect(host.textContent).toContain('Local Ollama')
  expect(host.textContent).toContain('Office Ollama')
  const listCard = host.querySelector<HTMLElement>('[data-agent-list-card]')!
  expect(listCard.querySelector('ul')).not.toBeNull()
  expect([...listCard.querySelectorAll<HTMLButtonElement>('button')].some((button) => button.textContent === '添加实例')).toBe(true)

  const editButtons = host.querySelectorAll<HTMLButtonElement>('button[aria-label="编辑 Agent"]')
  await act(async () => editButtons[1].click())
  expect(host.textContent).toContain('Agent 使用的模型服务平台。')
  expect(host.textContent).toContain('模型在内存中保留的时长，例如 10m。')
  const toolbar = host.querySelector<HTMLElement>('[data-agent-detail-toolbar]')!
  const back = [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '返回列表')!
  const remove = [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '删除实例')!
  expect(back.parentElement).toBe(toolbar.firstElementChild)
  expect(remove.parentElement).toBe(toolbar.lastElementChild)
  expect(toolbar.closest('section')).not.toBeNull()
  const name = host.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(name, 'Office Agent')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '保存配置')!
  await act(async () => save.click())

  expect(writes).toHaveLength(1)
  expect(writes[0].profiles[1].label).toBe('Office Agent')
  expect(writes[0].defaultProfileId).toBe('local')
})

test('returns to the current mode list when a detail id does not exist', async () => {
  const onNavigate = jest.fn()
  const request = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ settings }) }) as Response)

  await act(async () =>
    root.render(
      <Providers>
        <AgentSettingsView request={request} agentId="server-only-agent" onNavigate={onNavigate} />
      </Providers>
    )
  )

  expect(onNavigate).toHaveBeenCalledWith()
  expect(host.textContent).not.toContain('读取 Agent 配置失败')
})

test('refreshes the list after plugin sync but leaves an open detail draft untouched', async () => {
  const request = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ settings }) }) as Response)
  const onNavigate = jest.fn()

  await act(async () =>
    root.render(
      <Providers>
        <AgentSettingsView request={request} onNavigate={onNavigate} />
      </Providers>
    )
  )
  settings = { ...settings, profiles: settings.profiles.map((profile) => (profile.id === 'local' ? { ...profile, label: 'Synced Local' } : profile)) }
  await act(async () => window.dispatchEvent(new CustomEvent('chaya:agent-settings-synced')))
  expect(host.textContent).toContain('Synced Local')

  await act(async () =>
    root.render(
      <Providers>
        <AgentSettingsView request={request} agentId="local" onNavigate={onNavigate} />
      </Providers>
    )
  )
  const name = host.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(name, 'Unsaved Draft')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  settings = { ...settings, profiles: settings.profiles.map((profile) => (profile.id === 'local' ? { ...profile, label: 'Remote Change' } : profile)) }
  await act(async () => window.dispatchEvent(new CustomEvent('chaya:agent-settings-synced')))

  expect(name.value).toBe('Unsaved Draft')
})

test('shows connection results in a toast instead of inside the form', async () => {
  let resolveTest!: (value: Response) => void
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>((resolve) => (resolveTest = resolve))
    return { ok: true, status: 200, json: async () => ({ settings }) } as Response
  })

  await act(async () =>
    root.render(
      <Providers>
        <AgentSettingsView request={request} agentId="local" onNavigate={jest.fn()} />
      </Providers>
    )
  )

  const testButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '测试并读取模型')!
  await act(async () => testButton.click())
  expect(testButton.disabled).toBe(true)

  await act(async () => resolveTest({ ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen3' }] }) } as Response))

  const toast = document.body.querySelector<HTMLElement>('[role="status"]')!
  expect(toast.textContent).toContain('连接成功，可用模型 · 1')
  expect(host.textContent).not.toContain('连接成功，可用模型 · 1')
  expect(testButton.disabled).toBe(false)
})
