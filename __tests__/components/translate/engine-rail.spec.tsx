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

async function render(onChange = jest.fn(), revision = 0) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <TranslateEngineRail key={revision} onChange={onChange} />
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
  expect(section('Agent').textContent).toContain('用大模型翻译，优先尝试。所有游戏共用')
  expect(section('翻译平台').textContent).toContain('Agent 都失败时使用的在线翻译服务')
  expect(section('翻译平台').textContent).toContain('Bing')
  expect(host.querySelector('section > div > button[aria-controls^="translate-engine-group-"]')).toBeNull()
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

test('clicking an agent title opens a detail page instead of expanding the row', async () => {
  serve(state)
  await render()
  const agent = section('Agent')
  expect(agent.querySelector('[aria-label="Agent 设置"]')).toBeNull()
  const title = agent.querySelector<HTMLButtonElement>('button[aria-label="编辑 Remote GPU"]')!
  expect(title.hasAttribute('aria-expanded')).toBe(false)
  expect(title.querySelector('svg')).not.toBeNull()
  await act(async () => title.click())
  expect(host.querySelector('section[aria-label="Agent"]')).toBeNull()
  expect(host.querySelector('[role="toolbar"] [aria-label="移除"]')).not.toBeNull()
  expect(host.textContent).toContain('并发请求数上限')
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="返回翻译工具列表"]')!.click())
  expect(section('Agent').textContent).toContain('Remote GPU')
})

test('agent config is a draft: leaving detail does not save changes', async () => {
  serve(state)
  await render()
  const agent = section('Agent')
  await act(async () => agent.querySelector<HTMLButtonElement>('button[aria-label="编辑 Remote GPU"]')!.click())
  const save = host.querySelector<HTMLButtonElement>('button[aria-label="保存"]')!
  expect(save.disabled).toBe(true)
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="是否允许并发"]')!.click())
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="保存"]')!.disabled).toBe(false)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="返回翻译工具列表"]')!.click())
  expect(host.querySelector('[role="toolbar"]')).toBeNull()
  expect(section('Agent').textContent).toContain('Remote GPU')
  expect(mockTranslationFetch.mock.calls.map(([, init]) => JSON.parse(init.body)).filter((body) => body.mode === 'switches' && body.agents)).toEqual([])
})

test('unready offline engines cannot be enabled but can be disabled', async () => {
  const offline = { ...state, switches: { bing: false, google: false, apple: true, bergamot: false }, order: ['apple', 'bergamot'] }
  serve(offline)
  const onChange = await render()
  const apple =
    host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Apple 原生翻译 翻译"]') || host.querySelector<HTMLButtonElement>('[role="switch"][aria-checked="true"]')!
  const bergamot = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((el) => el.getAttribute('aria-label')?.includes('Bergamot'))!
  expect(apple.disabled).toBe(false)
  expect(bergamot.disabled).toBe(true)
  expect(onChange.mock.calls.at(-1)?.[1]).not.toContain('apple')
  await act(async () => apple.click())
  expect(JSON.parse(mockTranslationFetch.mock.calls.at(-1)![1].body)).toEqual({ mode: 'switches', switches: { apple: false } })
})

test('offline readiness uses a loading badge, offers guidance and becomes ready after rechecking', async () => {
  let finishCheck!: (value: unknown) => void
  let checks = 0
  mockTranslationFetch.mockImplementation(async (_path: string, init: { body: string }) => {
    const { mode } = JSON.parse(init.body)
    if (mode === 'agents') return json(agentsBody)
    if (mode === 'apple-status') return json({ installed: true, status: 'installed' })
    if (mode === 'bergamot-status') {
      checks++
      if (checks === 1)
        return new Promise((resolve) => {
          finishCheck = resolve
        })
      return json({ installed: true, status: 'ready' })
    }
    return json({ ...state, switches: { ...state.switches, apple: false, bergamot: false }, order: ['apple', 'bergamot', ...state.order] })
  })
  await render()
  const row = [...host.querySelectorAll('li')].find((el) => el.textContent?.includes('Bergamot'))!
  expect(row.querySelector('[role="status"][aria-busy="true"]')?.textContent).toBe('检测中')
  expect(row.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true)
  await act(async () => finishCheck(json({ installed: false, status: 'model_pack_missing' })))
  const guide = [...row.querySelectorAll('button')].find((el) => el.textContent === '设置指引')!
  await act(async () => guide.click())
  expect(host.querySelector('section[aria-label="离线机翻"]')).toBeNull()
  expect(host.textContent).toContain('当前语向缺少 Bergamot 离线语言包')
  expect(host.textContent).not.toContain('build:bergamot')
  await act(async () => [...host.querySelectorAll('button')].find((el) => el.textContent === '重新检测')!.click())
  expect(checks).toBe(2)
  expect(host.textContent).toContain('已就绪，可以开启此引擎')
  expect(host.querySelector('[aria-busy="true"]')).toBeNull()
  expect(host.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false)
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
})

test('Apple setup guide uses the detected language pair; unsupported pairs do not offer pack installation', async () => {
  let supported = true
  mockTranslationFetch.mockImplementation(async (_path: string, init: { body: string }) => {
    const { mode } = JSON.parse(init.body)
    if (mode === 'agents') return json(agentsBody)
    if (mode === 'apple-status') return json({ installed: false, status: supported ? 'supported' : 'unsupported', source: 'en', target: 'fr' })
    if (mode === 'bergamot-status') return json({ installed: false, status: 'unavailable' })
    return json({ ...state, switches: { ...state.switches, apple: false, bergamot: false }, order: ['apple', 'bergamot', ...state.order] })
  })
  await render()
  const row = [...host.querySelectorAll('li')].find((el) => el.textContent?.includes('Apple'))!
  await act(async () => [...row.querySelectorAll('button')].find((el) => el.textContent === '设置指引')!.click())
  const guide = [...host.querySelectorAll('button')].find((el) => el.textContent === '设置指引')!
  await act(async () => guide.click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('English (en)')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Français (fr)')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  supported = false
  await act(async () => [...host.querySelectorAll('button')].find((el) => el.textContent === '重新检测')!.click())
  expect(host.textContent).toContain('当前语言对不受此引擎支持')
  expect([...host.querySelectorAll('button')].filter((el) => el.textContent === '设置指引')).toHaveLength(0)
})
