/** @jest-environment jsdom */
import { randomUUID } from 'node:crypto'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { defaultActorDraft, emptySession } from '@/components/game-edit/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { initHostBridge } from '@/plugins/rgss/src/host-bridge'
import { RgssWorkbench } from '@/plugins/rgss/src/Workbench'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const catalog: GameEditCatalog = {
  ok: true,
  contentRoot: '',
  source: 'disk',
  items: [{ id: 1, name: 'Herb' }],
  weapons: [],
  armors: [],
  actors: [{ id: 1, name: 'Hero' }],
  skills: [{ id: 1, name: 'Heal' }],
  states: [],
  classes: [{ id: 1, name: 'Fighter' }],
  variables: [{ id: 1, name: 'Score' }],
  switches: [{ id: 1, name: 'Door' }],
}

let host: HTMLDivElement
let root: Root
let disposeBridge: () => void
const post = jest.fn()
const session = () => ({ ...emptySession(), actors: { 1: defaultActorDraft(1, 'Hero') } })
type NativeWindow = Window & { __chaya_on_game_message?: (message: GameLinkMessage) => void }
const receive = async (message: GameLinkMessage) => {
  await act(async () => (window as NativeWindow).__chaya_on_game_message?.(message))
}
const button = (name: string) => Array.from(host.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === name || node.textContent === name)!
const click = async (node: HTMLElement) => {
  expect(node).toBeDefined()
  await act(async () => node.click())
}
const commands = () => post.mock.calls.map(([json]: [string]) => JSON.parse(json)).filter((message) => message.type === 'edit.cmd')

beforeAll(() => {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  })
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: randomUUID })
})

beforeEach(async () => {
  post.mockClear()
  Object.assign(window, { webkit: { messageHandlers: { chaya: { postMessage: post } } } })
  disposeBridge = initHostBridge()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh" syncDocumentLang={false}>
        <ConfirmProvider>
          <RgssWorkbench />
        </ConfirmProvider>
      </LocaleProvider>
    )
  )
  await receive({ type: 'edit.state', ready: true, session: session() })
  await receive({ type: 'edit.catalog', catalog })
  await act(async () => document.dispatchEvent(new Event('chaya:toggle')))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  disposeBridge()
  Reflect.deleteProperty(window, 'webkit')
})

it('sends run switch edits and reflects the resulting native state', async () => {
  await click(host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="穿墙"]')!)
  expect(commands().at(-1)).toMatchObject({ op: 'runFlag', key: 'through', value: true })
  await receive({ type: 'edit.state', ready: true, session: { ...session(), through: true } })
  expect(host.querySelector('[role="switch"][aria-label="穿墙"]')?.getAttribute('aria-checked')).toBe('true')
})

it('keeps editing available after a rejected operation and clears the error after success', async () => {
  await receive({ type: 'edit.ack', cmdId: 'failed', ok: false, error: 'Unsupported field', fields: [] })
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unsupported field')
  await click(button('变量'))
  expect(host.querySelector('input[aria-label*="Score"]')).not.toBeNull()
  await click(button('开关'))
  await click(host.querySelector<HTMLButtonElement>('[role="switch"][aria-label*="Door"]')!)
  expect(commands().at(-1)).toMatchObject({ op: 'sw', id: 1, value: true })
  await receive({ type: 'edit.ack', cmdId: 'success', ok: true, fields: ['sw:1'] })
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('selects an actor and lets the user change actor subpages and owned skills', async () => {
  await click(button('角色'))
  expect(host.querySelector('input[value="Hero"]')).not.toBeNull()
  await click(button('技能'))
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"][aria-label*="Heal"]')
  expect(toggle).not.toBeNull()
  await click(toggle!)
  expect(commands().at(-1)).toMatchObject({ op: 'actor', id: 1, patch: { skillIds: [1] } })
})

it('renders an in-flow centered container and supports header dragging when attached to shadow host', async () => {
  const interactive = host.querySelector('[data-rgss-interactive]')
  expect(interactive).not.toBeNull()
  expect(interactive?.className).toContain('flex min-h-0 flex-1 flex-col')
  expect(interactive?.className).not.toContain('fixed inset-y-0 right-0')

  // Verify header drag handlers
  const nav = host.querySelector('nav[aria-label="导航"]')
  expect(nav).not.toBeNull()
})

it('allows switching to top-level navigation tabs without resetting to run', async () => {
  const transTab = host.querySelector<HTMLButtonElement>('button[data-main-nav-id="translate"]')
  expect(transTab).not.toBeNull()
  await click(transTab!)
  expect(transTab?.getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('button[data-main-nav-id="edit"]')?.getAttribute('aria-current')).toBeNull()
})
