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

function controlledSse() {
  const queued: Array<{ done: boolean; value?: Uint8Array }> = []
  const waiting: Array<(value: { done: boolean; value?: Uint8Array }) => void> = []
  const deliver = (value: { done: boolean; value?: Uint8Array }) => {
    const resolve = waiting.shift()
    if (resolve) resolve(value)
    else queued.push(value)
  }
  return {
    response: {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => queued.shift() || new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => waiting.push(resolve)),
        }),
      },
    } as unknown as Response,
    push: (event: unknown) => deliver({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`) }),
    close: () => deliver({ done: true }),
  }
}

async function enterPrompt(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
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
      { type: 'progress.updated', summary: '已修改金币，正在继续观察。', cycle: 1 },
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

  expect(document.body.textContent).toContain('操作详情')
  expect(document.body.textContent).toContain('chaya_edit_set')
  expect(document.body.textContent).toContain('已修改金币，正在继续观察。')
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

test('requires an explicit stop before starting another task and ignores late events', async () => {
  const first = controlledSse()
  const second = controlledSse()
  let postCount = 0
  const request = jest.fn(async (path: string, init?: RequestInit) => {
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
    if (init?.method === 'DELETE') return json({ ok: true })
    postCount += 1
    return postCount === 1 ? first.response : second.response
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
  await enterPrompt(textarea, '第一个任务')
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!.click())
  await act(async () => first.push({ type: 'turn.started', turnId: 'turn-old', sessionId: 'session-a' }))
  expect(document.body.textContent).toContain('进行中')

  await enterPrompt(textarea, '替换任务')
  expect(document.querySelector('button[aria-label="停止并开始新任务"]')).toBeNull()
  const stop = document.querySelector<HTMLButtonElement>('button[aria-label="停止"]')!
  await act(async () => stop.click())
  const send = document.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!
  await act(async () => {
    send.click()
    send.click()
  })
  await act(async () => second.push({ type: 'turn.started', turnId: 'turn-new', sessionId: 'session-a' }))
  await act(async () => second.push({ type: 'assistant.delta', text: '新任务结果' }))
  await act(async () => first.push({ type: 'assistant.delta', text: '旧任务迟到结果' }))
  await act(async () => first.push({ type: 'turn.completed', reason: 'answered' }))

  const calls = request.mock.calls.map(([path, init]) => `${init?.method || 'GET'} ${path}`)
  expect(calls.filter((item) => item === 'POST /api/game-agent/turn')).toHaveLength(2)
  expect(calls.indexOf('DELETE /api/game-agent/turn/turn-old?gameId=game-a')).toBeLessThan(calls.lastIndexOf('POST /api/game-agent/turn'))
  expect(document.body.textContent).toContain('新任务结果')
  expect(document.body.textContent).not.toContain('旧任务迟到结果')

  await act(async () => second.close())
})
