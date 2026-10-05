/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { TranslateEngineRail } from '@/components/translate/TranslateEngineRail'

const mockTranslationFetch = jest.fn()
const mockNotify = { success: jest.fn(), error: jest.fn(), warning: jest.fn() }
jest.mock('@/components/translate/TranslationRuntimeContext', () => ({ useTranslationFetch: () => mockTranslationFetch }))
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const state = {
  switches: { bing: true, google: false },
  agents: [{ id: 'a1', profileId: 'gpu', model: '', enabled: true }],
  order: ['bing', 'agent:a1', 'google'],
}

let host: HTMLDivElement
let root: Root
const agentsBody = {
  profiles: [
    { id: 'gpu', label: 'Remote GPU', defaultModel: 'qwen' },
    { id: 'cpu', label: 'Local CPU', defaultModel: '' },
  ],
  models: {},
}

function serve(switches: unknown, agents: unknown = agentsBody) {
  mockTranslationFetch.mockImplementation(async (_path: string, init: { body: string }) => json(JSON.parse(init.body).mode === 'agents' ? agents : switches))
}

beforeEach(() => {
  mockTranslationFetch.mockReset()
  Object.values(mockNotify).forEach((fn) => fn.mockReset())
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

async function render(onChange = jest.fn()) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <TranslateEngineRail onChange={onChange} />
      </LocaleProvider>
    )
  )
  await act(async () => {})
  return onChange
}

function section(name: string) {
  return host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!
}

test('splits agents and platforms; agent rows use the instance label', async () => {
  serve(state)
  const onChange = await render()
  expect(section('Agent').textContent).toContain('Remote GPU')
  expect(section('Agent').textContent).toContain('qwen')
  expect(section('Agent').textContent).not.toContain('实例默认')
  const platformHeader = section('翻译平台').querySelector<HTMLButtonElement>('button[aria-expanded]')!
  expect(platformHeader.getAttribute('aria-expanded')).toBe('true')
  expect(section('翻译平台').textContent).toContain('Bing')
  await act(async () => platformHeader.click())
  expect(platformHeader.getAttribute('aria-expanded')).toBe('false')
  expect(section('翻译平台').textContent).not.toContain('Bing')
  expect(section('Agent').textContent).toContain('Remote GPU')
  expect(onChange).toHaveBeenLastCalledWith(state.switches, ['agent:a1', 'bing'])
})

test('toggling an agent saves the whole agent list', async () => {
  serve(state)
  await render()
  const toggle = section('Agent').querySelector<HTMLElement>('[aria-label="Remote GPU 翻译"]')!
  await act(async () => toggle.click())
  const body = JSON.parse(mockTranslationFetch.mock.calls.at(-1)![1].body)
  expect(body).toEqual({ mode: 'switches', agents: [{ id: 'a1', profileId: 'gpu', model: '', enabled: false }] })
})

test('explains when agent instances cannot be loaded (no local service)', async () => {
  serve({ ...state, agents: [], order: ['bing', 'google'] }, { ok: false, error: { message: 'Agent 实例需要 Chaya 本机服务（0）' } })
  await render()
  expect(section('Agent').textContent).toContain('还没有添加 Agent')
  expect(section('Agent').textContent).toContain('无法读取 Agent 实例：Agent 实例需要 Chaya 本机服务（0）')
})

test('in-game shadow root: the add menu portals inside the shadow root; added instances cannot be added again', async () => {
  serve(state)
  const shadowHost = document.createElement('div')
  document.body.appendChild(shadowHost)
  const shadow = shadowHost.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')
  shadow.appendChild(mount)
  const shadowRoot = createRoot(mount)
  try {
    await act(async () =>
      shadowRoot.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateEngineRail />
        </LocaleProvider>
      )
    )
    await act(async () => {})
    const trigger = shadow.querySelector<HTMLButtonElement>('button[aria-label="添加 Agent 实例"]')!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
      trigger.click()
    })
    await act(async () => {})
    const items = [...shadow.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const added = items.find((el) => el.textContent?.includes('Remote GPU'))!
    expect(added.textContent).toContain('已添加')
    expect(added.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    const calls = mockTranslationFetch.mock.calls.length
    await act(async () => added.click())
    expect(mockTranslationFetch.mock.calls.length).toBe(calls)
    await act(async () => items.find((el) => el.textContent?.includes('Local CPU'))!.click())
    const body = JSON.parse(mockTranslationFetch.mock.calls.at(-1)![1].body)
    expect(body.agents).toHaveLength(2)
    expect(body.agents[1]).toMatchObject({ profileId: 'cpu', enabled: true })
  } finally {
    await act(async () => shadowRoot.unmount())
  }
})

test('clicking an agent title toggles its config; there is no separate settings button', async () => {
  serve(state)
  await render()
  const agent = section('Agent')
  expect(agent.querySelector('[aria-label="Agent 设置"]')).toBeNull()
  const title = agent.querySelector<HTMLButtonElement>('button[aria-label="编辑 Remote GPU"]')!
  expect(title.getAttribute('aria-expanded')).toBe('false')
  expect(title.querySelector('svg')).not.toBeNull()
  await act(async () => title.click())
  expect(title.getAttribute('aria-expanded')).toBe('true')
  expect(agent.textContent).toContain('移除')
  await act(async () => title.click())
  expect(agent.textContent).not.toContain('移除')
})
