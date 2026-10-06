/** @jest-environment jsdom */
import { TextDecoder, TextEncoder } from 'node:util'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { type GameAgentRequest, GameAgentWorkspace } from '@/components/game-agent/GameAgentWorkspace'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

let host: HTMLDivElement
let root: Root

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, TextDecoder, TextEncoder })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: jest.fn() })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  })
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

function sse(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
  let read = false
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => (read ? { done: true, value: undefined } : ((read = true), { done: false, value: bytes })) }) },
  } as unknown as Response
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

test('keeps completed tool calls visible with the assistant reply', async () => {
  const request = jest.fn(async (path: string) => {
    if (path.startsWith('/api/game-agent/status')) {
      return json({
        available: true,
        gameOnline: true,
        profiles: [{ id: 'local', label: 'Local Ollama', provider: 'ollama', online: true, models: [{ name: 'gemma' }], defaultModel: 'gemma', reason: null }],
        defaultProfileId: 'local',
        session: null,
        reason: null,
      })
    }
    return sse([
      { type: 'turn.started', turnId: 'turn-a', sessionId: 'session-a' },
      { type: 'tool.started', callId: '1-0', name: 'chaya_edit_set' },
      { type: 'tool.completed', callId: '1-0', name: 'chaya_edit_set', ok: true },
      { type: 'assistant.delta', text: '已完成调用。' },
      { type: 'turn.completed', text: '已完成调用。', reason: 'answered' },
    ])
  }) as unknown as jest.MockedFunction<GameAgentRequest>

  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameAgentWorkspace gameId="game-a" request={request} />
      </LocaleProvider>
    )
  })
  await act(async () => {})

  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(textarea, '设置金币')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const send = document.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!
  await act(async () => send.click())

  expect(document.body.textContent).toContain('已调用')
  expect(document.body.textContent).toContain('chaya_edit_set')
  expect(document.body.textContent).toContain('已完成调用。')
})

test('does not start a second turn before the first SSE response arrives', async () => {
  let resolveTurn!: (response: Response) => void
  const turnResponse = new Promise<Response>((resolve) => {
    resolveTurn = resolve
  })
  const request = jest.fn(async (path: string) => {
    if (path.startsWith('/api/game-agent/status')) {
      return json({
        available: true,
        gameOnline: false,
        profiles: [{ id: 'local', label: 'Local Ollama', provider: 'ollama', online: true, models: [{ name: 'gemma' }], defaultModel: 'gemma', reason: null }],
        defaultProfileId: 'local',
        session: null,
        reason: null,
      })
    }
    return turnResponse
  }) as unknown as jest.MockedFunction<GameAgentRequest>

  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameAgentWorkspace gameId="chaya-console" request={request} />
      </LocaleProvider>
    )
  })
  await act(async () => {})

  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(textarea, '检查配置')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const send = document.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!
  await act(async () => {
    send.click()
    send.click()
  })

  expect(request.mock.calls.filter(([path]) => path === '/api/game-agent/turn')).toHaveLength(1)

  await act(async () => {
    resolveTurn(
      sse([
        { type: 'turn.started', turnId: 'turn-a', sessionId: 'session-a' },
        { type: 'assistant.delta', text: '完成。' },
        { type: 'turn.completed', text: '完成。', reason: 'answered' },
      ])
    )
    await turnResponse
  })
})

test('replays the most recent completed turn when the sidebar is reopened', async () => {
  const request = jest.fn(async (path: string) => {
    if (path.startsWith('/api/game-agent/status')) {
      return json({
        available: true,
        gameOnline: true,
        profiles: [{ id: 'local', label: 'Local Ollama', provider: 'ollama', online: true, models: [{ name: 'gemma' }], defaultModel: 'gemma', reason: null }],
        defaultProfileId: 'local',
        session: { id: 'session-a', profileId: 'local', activeTurnId: null, recentTurnId: 'turn-a' },
        reason: null,
      })
    }
    return sse([
      { type: 'goal.updated', seq: 1, summary: '完成当前战斗' },
      { type: 'assistant.delta', seq: 2, text: '本场战斗结果：victory。' },
      { type: 'turn.completed', seq: 3, text: '本场战斗结果：victory。', reason: 'verified' },
    ])
  }) as unknown as jest.MockedFunction<GameAgentRequest>

  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameAgentWorkspace gameId="game-a" request={request} />
      </LocaleProvider>
    )
  })
  await act(async () => {})

  expect(request.mock.calls.some(([path]) => path.startsWith('/api/game-agent/turn/turn-a/events?'))).toBe(true)
  expect(document.body.textContent).toContain('本场战斗结果：victory。')
})
