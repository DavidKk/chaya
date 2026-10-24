/** @jest-environment jsdom */
import { TextDecoder, TextEncoder } from 'node:util'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { CompanionPanel } from '@/components/game-agent/CompanionPanel'
import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { DEFAULT_TOOL_SETTINGS } from '@/lib/game-agent/tool-settings'

const confirm = jest.fn<Promise<boolean>, [{ title: string; confirmVariant?: string }]>()

jest.mock('@/components/confirm/ConfirmProvider', () => ({
  ...jest.requireActual('@/components/confirm/ConfirmProvider'),
  useConfirm: () => confirm,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, TextDecoder, TextEncoder })

let host: HTMLDivElement
let root: Root
let calls: Array<{ path: string; method: string }>
let agentStatus: unknown

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const companionStatus = () => ({
  version: 1,
  stamp: {
    scope: { libraryGameId: 'game-a', dataRevision: '', playthroughId: '', runtimeInstanceId: 'rt-1', segmentId: '' },
    contextEpoch: 1,
    factsRevision: 1,
  },
  capabilities: { chat: 'supported', route: 'supported', events: 'supported', control: 'supported' },
  activeRequestId: null,
  memory: { epoch: 1, recording: true, count: 0, persistence: 'ready' as const },
  naturalEnhancement: false,
})
const request: GameAgentRequest = async (path, init) => {
  const method = init?.method || 'GET'
  calls.push({ path, method })
  if (path.startsWith('/api/integration/game-agent/tools')) return json({ settings: { ...DEFAULT_TOOL_SETTINGS, companionEnabled: true } })
  if (path.startsWith('/api/game-agent/status')) return json(agentStatus)
  if (path.startsWith('/api/game-agent/companion') && method === 'POST') {
    const body = JSON.parse(String(init?.body || '{}')) as { message?: { type?: string } }
    const type = body.message?.type
    if (type === 'agent.companion.status') return json({ result: companionStatus() })
    if (type === 'agent.companion.events') return json({ result: { events: [], lastSeq: 0, gap: false, status: companionStatus() } })
    if (type === 'agent.companion.route') return json({ result: { kind: 'chat', stamp: companionStatus().stamp } })
    if (type === 'agent.companion.chat') return json({ result: { requestId: 'chat-1', messageId: 'msg-1' } })
    if (type === 'agent.memory.settings' || type === 'agent.memory.clear' || type === 'agent.companion.cancel') return json({ result: { ok: true } })
    return json({ result: { ok: true } })
  }
  if (path.startsWith('/api/game-agent/turn') && method === 'DELETE') return json({ ok: true, cleared: 1 })
  return { ok: false, status: 404, json: async () => ({}) } as Response
}

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { scrollTo: jest.fn() })
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

beforeEach(async () => {
  localStorage.clear()
  calls = []
  agentStatus = { available: false, profiles: [], defaultProfileId: '', session: null, reason: null }
  confirm.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={request} />
      </LocaleProvider>
    )
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const clearButton = () => host.querySelector('button[aria-label="清理聊天"]') as HTMLButtonElement
const deletes = () => calls.filter((call) => call.method === 'DELETE')

it('toggles the thinking process from the toolbar and restores it after reload', async () => {
  const showActivity = host.querySelector<HTMLButtonElement>('button[aria-label="显示思考过程"]')!
  expect(showActivity).not.toBeNull()
  expect(showActivity.getAttribute('aria-pressed')).toBe('false')

  await act(async () => showActivity.click())
  expect(localStorage.getItem('chaya.companion.view.game-a')).toBe('activity')
  expect(host.querySelector('button[aria-label="显示聊天"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(host.textContent).toContain('暂无 Agent 过程')

  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={request} />
      </LocaleProvider>
    )
  )
  expect(host.querySelector('button[aria-label="显示聊天"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(host.textContent).toContain('暂无 Agent 过程')
})

it('offers a smooth return to the bottom after the user scrolls up', async () => {
  await act(async () => root.unmount())
  localStorage.setItem('chaya.companion.transcript.game-a', JSON.stringify({ messages: [{ id: 'm1', role: 'chaya', text: '先说一句', character: 'rin' }], activity: [] }))
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={request} />
      </LocaleProvider>
    )
  )
  const scroller = host.querySelector<HTMLDivElement>('#companion-chat')!
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
    scrollTop: { configurable: true, writable: true, value: 100 },
  })
  ;(scroller.scrollTo as jest.Mock).mockClear()

  await act(async () => scroller.dispatchEvent(new Event('scroll', { bubbles: true })))
  const bottom = host.querySelector<HTMLDivElement>('[role="button"][aria-label="滚动到底部"]')!
  expect(bottom).not.toBeNull()

  await act(async () => bottom.click())
  expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
  expect(host.querySelector('[role="button"][aria-label="滚动到底部"]')).toBeNull()
})

it('asks before clearing companion chat and keeps it when declined', async () => {
  confirm.mockResolvedValue(false)
  await act(async () => clearButton().click())
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '清理旅伴聊天记录？', confirmVariant: 'fail' }))
  expect(deletes()).toEqual([])
})

it('clears companion chat once confirmed', async () => {
  await act(async () => root.unmount())
  localStorage.setItem('chaya.companion.transcript.game-a', JSON.stringify({ messages: [{ id: 'm1', role: 'chaya', text: '先说一句', character: 'rin' }], activity: [] }))
  confirm.mockResolvedValue(true)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={request} />
      </LocaleProvider>
    )
  )
  expect(host.textContent).toContain('先说一句')
  await act(async () => clearButton().click())
  expect(deletes()).toEqual([])
  expect(host.textContent).not.toContain('先说一句')
})

it('shows and stops the Agent task started from another surface', async () => {
  await act(async () => root.unmount())
  agentStatus = {
    available: true,
    profiles: [{ id: 'local', label: 'Local', online: true, models: [{ name: 'qwen' }], defaultModel: 'qwen' }],
    defaultProfileId: 'local',
    session: { id: 'session-a', activeTurnId: 'turn-a', activeTurn: { id: 'turn-a', state: 'running', capability: 'play', goal: '挂机练级' } },
    reason: null,
  }
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={request} />
      </LocaleProvider>
    )
  )

  const stop = host.querySelector<HTMLButtonElement>('button[aria-label="停止托管"]')!
  expect(stop).not.toBeNull()
  await act(async () => stop.click())
  expect(deletes()).toContainEqual({ path: '/api/game-agent/turn/turn-a?gameId=game-a', method: 'DELETE' })
})

it('keeps the selected runtime provider and model across games', async () => {
  localStorage.setItem('chaya.game-agent.runtime-selection', JSON.stringify({ profileId: 'gemini', model: 'gemini-2.5-flash' }))
  await act(async () => root.unmount())
  agentStatus = {
    available: true,
    profiles: [
      { id: 'ollama', label: 'Ollama', online: true, models: [{ name: 'qwen' }], defaultModel: 'qwen' },
      { id: 'gemini', label: 'Gemini', online: true, models: [{ name: 'gemini-2.5-flash' }], defaultModel: 'gemini-2.5-flash' },
    ],
    defaultProfileId: 'ollama',
    session: null,
    reason: null,
  }
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-b" open={false} observe={() => ({}) as never} request={request} />
      </LocaleProvider>
    )
  )
  const runtime = host.querySelector<HTMLButtonElement>('button[aria-label^="选择平台与模型"]')!
  expect(runtime.getAttribute('aria-label')).toContain('Gemini')
})

it('can stop a red running task button before the turn id arrives', async () => {
  await act(async () => root.unmount())
  agentStatus = {
    available: true,
    profiles: [{ id: 'local', label: 'Local', online: true, models: [{ name: 'qwen' }], defaultModel: 'qwen' }],
    defaultProfileId: 'local',
    session: null,
    reason: null,
  }
  let turnSignal: AbortSignal | undefined
  const slowTurn: GameAgentRequest = async (path, init) => {
    if (path.startsWith('/api/game-agent/companion') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as { message?: { type?: string } }
      if (body.message?.type === 'agent.companion.route') {
        return json({
          result: {
            kind: 'control',
            ticketId: 'ticket-1',
            goal: '继续游戏',
            shape: 'open',
            lifetime: 'goal',
            expiresAt: Date.now() + 60_000,
            stamp: companionStatus().stamp,
          },
        })
      }
      if (body.message?.type === 'agent.companion.control.start') {
        turnSignal = init.signal || undefined
        return new Promise<Response>((_resolve, reject) => turnSignal?.addEventListener('abort', () => reject(turnSignal?.reason), { once: true }))
      }
    }
    return request(path, init)
  }
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={slowTurn} />
      </LocaleProvider>
    )
  )
  const input = host.querySelector<HTMLInputElement>('input[aria-label]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '继续游戏')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input.form!.requestSubmit())
  const stop = host.querySelector<HTMLButtonElement>('button[aria-label="停止托管"]')!
  expect(stop.disabled).toBe(false)
  expect(stop.className).toContain('text-fail')
  await act(async () => stop.click())
  expect(turnSignal?.aborted).toBe(true)
})

it('shows the card an Agent asks with and replies with the picked option', async () => {
  await act(async () => root.unmount())
  agentStatus = {
    available: true,
    profiles: [{ id: 'local', label: 'Local', online: true, models: [{ name: 'qwen' }], defaultModel: 'qwen' }],
    defaultProfileId: 'local',
    session: { id: 'session-a', activeTurnId: 'turn-q', activeTurn: { id: 'turn-q', state: 'waiting_user', capability: 'play', goal: '去哪边' } },
    reason: null,
  }
  const replies: Array<{ path: string; body: Record<string, unknown> }> = []
  let push: (event: unknown) => void = () => {}
  const withTurn: GameAgentRequest = async (path, init) => {
    if (path.startsWith('/api/game-agent/turn/turn-q/events')) {
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve) => {
                push = (event) => resolve({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`) })
              }),
            cancel: async () => {},
          }),
        },
      } as unknown as Response
    }
    if (path.endsWith('/reply')) {
      replies.push({ path, body: JSON.parse(String(init?.body)) })
      return json({ ok: true })
    }
    return request(path, init)
  }
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={withTurn} />
      </LocaleProvider>
    )
  )
  await act(async () =>
    push({
      type: 'approval.required',
      question: '去哪边？',
      card: {
        kind: 'choice',
        text: '去哪边？',
        options: [
          { id: 'n', label: '北边洞窟' },
          { id: 's', label: '南边城镇' },
        ],
      },
    })
  )

  const card = host.querySelector('[role="group"]')!
  expect(card.textContent).toContain('去哪边？')
  expect(host.textContent?.match(/去哪边？/g)).toHaveLength(1)
  const south = [...card.querySelectorAll('button')].find((button) => button.textContent === '南边城镇')!
  await act(async () => south.click())
  expect(replies).toEqual([{ path: '/api/game-agent/turn/turn-q/reply', body: expect.objectContaining({ gameId: 'game-a', reply: 's' }) }])
  expect(card.querySelectorAll('button')).toHaveLength(0)
  expect(card.textContent).toContain('南边城镇')
})

it('offers to fetch a nearby chest and hands the walk to 托管 once accepted', async () => {
  await act(async () => root.unmount())
  agentStatus = {
    available: true,
    profiles: [{ id: 'local', label: 'Local', online: true, models: [{ name: 'qwen' }], defaultModel: 'qwen' }],
    defaultProfileId: 'local',
    session: null,
    reason: null,
  }
  const posts: Array<Record<string, unknown>> = []
  let push: (event: unknown) => void = () => {}
  const stream = (resolveRead: (value: { done: boolean; value?: Uint8Array }) => void) => {
    push = (event) => resolveRead({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`) })
  }
  const withTurn: GameAgentRequest = async (path, init) => {
    if (path.startsWith('/api/game-agent/companion') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as { message?: Record<string, unknown> }
      const type = body.message?.type
      if (type === 'agent.companion.route') {
        posts.push(body.message || {})
        return json({
          result: {
            kind: 'control',
            ticketId: 'ticket-chest',
            goal: '帮我去拿宝箱（5, 1）',
            shape: 'open',
            lifetime: 'goal',
            expiresAt: Date.now() + 60_000,
            stamp: companionStatus().stamp,
          },
        })
      }
      if (type === 'agent.companion.control.start') {
        return json({ result: { id: 'turn-chest', goal: '帮我去拿宝箱（5, 1）' } })
      }
    }
    if (path.startsWith('/api/game-agent/turn/turn-chest/events')) {
      return {
        ok: true,
        status: 200,
        body: { getReader: () => ({ read: () => new Promise((resolve) => stream(resolve)), cancel: async () => {} }) },
      } as unknown as Response
    }
    return request(path, init)
  }
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <CompanionPanel gameId="game-a" open={false} observe={() => ({}) as never} request={withTurn} />
      </LocaleProvider>
    )
  )
  const input = host.querySelector<HTMLInputElement>('input[aria-label]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '帮我去拿宝箱（5, 1）')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input.form!.requestSubmit())
  expect(posts).toEqual([expect.objectContaining({ type: 'agent.companion.route', prompt: '帮我去拿宝箱（5, 1）' })])
  await act(async () => push({ type: 'turn.started', turnId: 'turn-chest', sessionId: 'session-a' }))

  const stopAutopilot = host.querySelector<HTMLButtonElement>('button[aria-label="停止托管"]')!
  expect(stopAutopilot.disabled).toBe(false)
  expect(stopAutopilot.className).not.toContain('chaya-autopilot')
  expect(stopAutopilot.querySelector('svg')?.getAttribute('class')).toContain('chaya-autopilot-firefly')
  expect(clearButton()).not.toBeNull()
  expect(host.querySelector('button[aria-label^="选择平台与模型"]')).not.toBeNull()
  expect(host.querySelector<HTMLInputElement>('input[placeholder="托管中，可在工具栏停止托管"]')).not.toBeNull()
  await act(async () => stopAutopilot.click())
  expect(deletes()).toContainEqual({ path: '/api/game-agent/turn/turn-chest?gameId=game-a', method: 'DELETE' })
})
