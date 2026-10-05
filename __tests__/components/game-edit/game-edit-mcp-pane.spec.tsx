/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { GameEditMcpPane } from '@/components/game-edit/GameEditMcpPane'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import type { McpGatewayControl, McpGatewayStatus } from '@/lib/integration/mcp-gateway'

let container: HTMLDivElement
let root: Root

const status: McpGatewayStatus = { state: 'listening', port: 39271, url: 'http://127.0.0.1:39271/mcp', file: '/tmp/mcp.json', dir: '/tmp', fileExists: false }

function installGateway(rpc: McpGatewayControl['rpc']) {
  const control: McpGatewayControl = {
    available: true,
    enabled: true,
    status: () => status,
    refresh: async () => status,
    setPort: async () => status,
    resetPort: async () => status,
    rpc,
    openFolder: () => {},
    openDocs: () => {},
  }
  Object.assign(window, { ChayaAgent: { gateway: control } })
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
  globalThis.CSS ??= { escape: (value: string) => value } as unknown as typeof CSS
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as Window & { ChayaAgent?: unknown }).ChayaAgent
})

async function render() {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <ConfirmProvider>
          <GameEditMcpPane />
        </ConfirmProvider>
      </LocaleProvider>
    )
  })
}

const text = () => container.textContent ?? ''

it('shows the plugin MCP tool groups with the gateway card as overview', async () => {
  installGateway(jest.fn())
  await render()
  expect(text()).toContain('http://127.0.0.1:39271/mcp')
  for (const group of ['局内实时', '修改', '翻译', '共享翻译库', '日志']) expect(text()).toContain(group)
  expect(text()).not.toContain('游戏库')
  expect(text()).not.toContain('当前游戏')
})

it('runs the playground through the in-game gateway rpc', async () => {
  const rpc = jest.fn(async () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"ok":true}' }] } } }))
  installGateway(rpc)
  await render()
  const run = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('执行'))
  await act(async () => run?.click())
  expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ method: 'tools/call', params: expect.objectContaining({ name: 'chaya_live_games' }) }))
})

it('has no WebMCP sub-tab in the game window', async () => {
  installGateway(jest.fn())
  await render()
  expect(container.querySelector('[role="tab"]')).toBeNull()
  expect(text()).not.toContain('WebMCP')
})
