/** @jest-environment jsdom */
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let calls: Array<{ path: string; method: string }>

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const request: GameAgentRequest = async (path, init) => {
  const method = init?.method || 'GET'
  calls.push({ path, method })
  if (path.startsWith('/api/integration/game-agent/tools')) return json({ settings: { ...DEFAULT_TOOL_SETTINGS, companionEnabled: true } })
  if (path.startsWith('/api/game-agent/status')) return json({ available: false, profiles: [], defaultProfileId: '', session: null, reason: null })
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

const clearButton = () => host.querySelector('button[aria-label="清理卡住的任务"]') as HTMLButtonElement
const deletes = () => calls.filter((call) => call.method === 'DELETE')

it('asks before stopping every task of the game and keeps them when declined', async () => {
  confirm.mockResolvedValue(false)
  await act(async () => clearButton().click())
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '停止本游戏所有 Agent 任务？', confirmVariant: 'fail' }))
  expect(deletes()).toEqual([])
})

it('clears the game turns once confirmed', async () => {
  confirm.mockResolvedValue(true)
  await act(async () => clearButton().click())
  expect(deletes()).toEqual([{ path: '/api/game-agent/turn?gameId=game-a', method: 'DELETE' }])
  expect(host.textContent).toContain('已清理，可以重新交代任务了')
})
