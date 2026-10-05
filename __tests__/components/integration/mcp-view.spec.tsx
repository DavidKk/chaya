/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { McpView } from '@/components/integration/mcp/McpView'
import { WebMcpView } from '@/components/integration/webmcp/WebMcpView'
import { mcpToolsFor } from '@/lib/integration/mcp-availability'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'

let container: HTMLDivElement
let root: Root

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
  sessionStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(view: React.ReactNode) {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        {view}
      </LocaleProvider>
    )
  })
}

async function remount(view: React.ReactNode) {
  await act(async () => root.unmount())
  root = createRoot(container)
  await render(view)
}

const header = () => container.querySelector('header h2')?.textContent
const navButton = (label: string) => [...container.querySelectorAll('nav button')].find((b) => b.textContent?.startsWith(label)) as HTMLButtonElement
const playgroundTool = () =>
  container.querySelector('aside button[aria-haspopup="listbox"]')?.textContent ?? container.querySelector('button[aria-haspopup="listbox"]')?.textContent

const game = { overview: <p>overview</p>, rpc: jest.fn() }
const firstEditTool = mcpToolsFor('plugin').find((tool) => tool.group === 'edit')!.name

test('in game: the open group and the playground tool survive a remount (refresh)', async () => {
  await render(<McpView game={game} />)
  expect(header()).toBe('接入')
  await act(async () => navButton('修改').click())
  expect(header()).toBe('修改')
  expect(playgroundTool()).toContain(firstEditTool)

  await remount(<McpView game={game} />)
  expect(header()).toBe('修改')
  expect(playgroundTool()).toContain(firstEditTool)
})

test('on the web page the group comes from the route and nav items link to group URLs', async () => {
  const connection = { available: true, serviceMode: 'local', endpoint: 'http://127.0.0.1:3000/api/mcp', evalEnabled: true }
  globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => connection })) as unknown as typeof fetch
  await render(<McpView route={{ base: '/integration/mcp', section: 'live' }} />)
  expect(header()).toBe('局内实时')
  const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))
  expect(hrefs).toContain('/integration/mcp')
  expect(hrefs).toContain('/integration/mcp/edit')
  expect(playgroundTool()).toContain(MCP_TOOLS.find((tool) => tool.group === 'live')!.name)
})

test('WebMCP overview links to its route on the web page', async () => {
  await render(<WebMcpView route={{ base: '/integration/webmcp', section: 'nope' }} />)
  expect(container.querySelector('nav a')?.getAttribute('href')).toBe('/integration/webmcp')
  expect(container.querySelector('nav a')?.getAttribute('aria-current')).toBe('page')
})
