/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AgentCliProcessesPanel } from '@/components/game-agent/AgentCliProcessesPanel'
import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

jest.mock('@/components/notification/useNotification', () => ({
  useNotification: () => ({ success: jest.fn(), error: jest.fn() }),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let hidden = false

beforeEach(() => {
  jest.useFakeTimers()
  hidden = false
  jest.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  jest.useRealTimers()
})

function response(body: object) {
  return { ok: true, json: async () => body } as Response
}

async function mount(request: GameAgentRequest) {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <AgentCliProcessesPanel request={request} />
      </LocaleProvider>
    )
  )
}

test('defaults to this service, polls every ten seconds and pauses while hidden', async () => {
  const request = jest.fn<ReturnType<GameAgentRequest>, Parameters<GameAgentRequest>>(async () => response({ processes: [] }))
  await mount(request)
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('/api/game-agent/processes')
  expect(host.textContent).toContain('当前 Chaya 服务没有正在运行')
  await act(async () => jest.advanceTimersByTimeAsync(9_999))
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => jest.advanceTimersByTimeAsync(1))
  expect(request).toHaveBeenCalledTimes(2)
  hidden = true
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await jest.advanceTimersByTimeAsync(30_000)
  })
  expect(request).toHaveBeenCalledTimes(2)
  hidden = false
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(request).toHaveBeenCalledTimes(3)
})

test('switching source scope cancels the previous request and ignores its late result', async () => {
  let finish!: (value: Response) => void
  const request = jest.fn<ReturnType<GameAgentRequest>, Parameters<GameAgentRequest>>()
  request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve))).mockResolvedValue(response({ processes: [] }))
  await mount(request)
  const originalSignal = request.mock.calls[0][1]?.signal
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-pressed]')!
  await act(async () => toggle.click())
  expect(originalSignal?.aborted).toBe(true)
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(request.mock.calls[1][0]).toBe('/api/game-agent/processes?includeSystem=1')
  expect(host.textContent).toContain('本机未发现匹配')
  await act(async () => finish({ ok: false, status: 500, json: async () => ({ error: { message: 'stale error' } }) } as Response))
  expect(host.textContent).not.toContain('stale error')
  expect(host.textContent).toContain('本机未发现匹配')
  await act(async () => toggle.click())
  expect(request.mock.calls[2][0]).toBe('/api/game-agent/processes')
  const signal = request.mock.calls[2][1]?.signal
  await act(async () => root.unmount())
  expect(signal?.aborted).toBe(true)
  root = createRoot(host)
})
