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
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

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
  const deleteButtons = listCard.querySelectorAll<HTMLButtonElement>('button[aria-label="删除"]')
  expect([...editButtons].every((button) => button.dataset.variant === 'plain' && button.className.includes('border-transparent'))).toBe(true)
  expect(deleteButtons).toHaveLength(2)
  expect(
    [...listCard.querySelectorAll('li')].every((row) => {
      const actions = [...row.querySelectorAll<HTMLButtonElement>('button')]
      return actions.map((button) => button.getAttribute('aria-label')).join(',') === '编辑 Agent,删除'
    })
  ).toBe(true)

  await act(async () => deleteButtons[1].click())
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.textContent).toContain('Office Ollama')
  expect(writes).toHaveLength(0)
  const cancelDelete = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '取消')!
  await act(async () => cancelDelete.click())
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(writes).toHaveLength(0)

  await act(async () => editButtons[1].click())
  expect(host.textContent).toContain('Agent 使用的模型服务平台。')
  expect(host.textContent).toContain('模型在内存中保留的时长。')
  expect(host.textContent).toContain('10 分钟')
  const keepAlive = [...host.querySelectorAll<HTMLInputElement>('input')].find((input) => input.value === '600000')!
  await act(async () => keepAlive.focus())
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(keepAlive, '5430250')
    keepAlive.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(host.textContent).toContain('1 小时 30 分钟 30 秒 250 毫秒')
  await act(async () => keepAlive.blur())
  expect(host.textContent).toContain('1 小时 30 分钟 30 秒 250 毫秒')
  const forever = host.querySelector<HTMLButtonElement>('button[aria-label="常驻内存"]')!
  await act(async () => forever.click())
  expect(keepAlive.disabled).toBe(true)
  expect(host.querySelector('button[aria-label="取消常驻"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(host.textContent).toContain('常驻')
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="取消常驻"]')!.click())
  expect(keepAlive.disabled).toBe(false)
  expect(host.textContent).toContain('1 小时 30 分钟 30 秒 250 毫秒')
  const toolbar = host.querySelector<HTMLElement>('[data-agent-detail-toolbar]')!
  const back = [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '返回')!
  const remove = [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '删除')!
  const testButton = [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '测试')!
  const saveButton = [...toolbar.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '保存配置')!
  expect(back.parentElement).toBe(toolbar.firstElementChild)
  expect(remove.parentElement).toBe(toolbar.firstElementChild)
  expect([...toolbar.firstElementChild!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['返回', '删除'])
  expect(testButton.parentElement).toBe(toolbar.lastElementChild)
  expect(saveButton.parentElement).toBe(toolbar.lastElementChild)
  expect(testButton.nextElementSibling).toBe(saveButton)
  expect(host.textContent).not.toContain('验证服务连接并刷新可用模型列表。')
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="刷新"]')).toBeNull()
  const modelCalls = () => request.mock.calls.filter(([, init]) => init?.method === 'POST' && String(init.body).includes('"action":"models"')).length
  const modelSelect = host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')[1]
  expect(modelCalls()).toBe(0)
  await act(async () => modelSelect.click())
  expect(modelCalls()).toBe(1)
  await act(async () => modelSelect.click())
  expect(toolbar.closest('section')).not.toBeNull()
  expect(host.querySelectorAll('[data-agent-detail-card]')).toHaveLength(1)
  expect(toolbar.closest('[data-agent-detail-card]')?.textContent).toContain('Temperature')
  expect(toolbar.closest('[data-agent-detail-card]')?.textContent).toContain('Keep Alive')
  const name = host.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(name, 'Office Agent')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => saveButton.click())

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

test('shows a plain test result in a toast instead of describing the model refresh', async () => {
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

  const testButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '测试')!
  await act(async () => testButton.click())
  expect(testButton.disabled).toBe(true)

  await act(async () => resolveTest({ ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen3' }] }) } as Response))

  const toast = document.body.querySelector<HTMLElement>('[role="status"]')!
  expect(toast.textContent).toContain('测试成功')
  expect(toast.textContent).not.toContain('模型')
  expect(testButton.disabled).toBe(false)
})

test('loads cached models immediately and refreshes them automatically from the endpoint', async () => {
  jest.useFakeTimers()
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ models: [{ name: 'gemma4' }], defaultModel: 'gemma4' }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ settings, models: { local: [{ name: 'qwen3' }] } }) } as Response
  })

  try {
    await act(async () =>
      root.render(
        <Providers>
          <AgentSettingsView request={request} agentId="local" onNavigate={jest.fn()} />
        </Providers>
      )
    )

    const selects = host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')
    expect(selects[1]?.textContent).toContain('qwen3')
    await act(async () => jest.advanceTimersByTime(500))

    const modelRequest = request.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(modelRequest?.[1]?.body))).toMatchObject({ action: 'models', profile: { endpoint: 'http://127.0.0.1:11434' } })
    expect(selects[1]?.textContent).toContain('gemma4')
  } finally {
    jest.useRealTimers()
  }
})
