/** @jest-environment jsdom */
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { MiniPanelDock } from '@/components/game-tools/MiniPanelDock'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import type { ToolSettingsPatch } from '@/components/game-tools/useToolSettings'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { DEFAULT_TOOL_SETTINGS, type ToolSettings } from '@/lib/game-agent/tool-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let current: ToolSettings
let dismissMiniMap: () => void
const update = jest.fn()

function Harness({ initial }: { initial: ToolSettings }) {
  const [settings, setSettings] = useState(initial)
  const { dismiss } = useToolPanelVisibility('miniMap', settings.miniMapEnabled)
  useEffect(() => {
    current = settings
    dismissMiniMap = dismiss
  })
  const apply = async (patch: ToolSettingsPatch) => {
    update(patch)
    setSettings((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))
  }
  return (
    <LocaleProvider initialLocale="zh" initialPreference="zh">
      <MiniPanelDock settings={settings} update={apply} />
    </LocaleProvider>
  )
}

async function renderDock(patch: Partial<ToolSettings> = {}) {
  await act(async () => root.render(<Harness initial={{ ...DEFAULT_TOOL_SETTINGS, panelDockEnabled: true, ...patch }} />))
}

const toolbar = () => document.querySelector('[role="group"]') as HTMLElement
const labels = () => Array.from(toolbar().querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))
const button = (label: string) => toolbar().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
  localStorage.clear()
  update.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

it('shows panel buttons, close all, then the orientation toggle, centred at the top', async () => {
  await renderDock({ companionEnabled: true })
  expect(labels()).toEqual(['迷你地图', '旅伴', '自动存档', '快速存档', '关闭全部迷你面板', '改为纵向排列'])
  expect(button('旅伴').getAttribute('aria-pressed')).toBe('true')
  expect(button('迷你地图').getAttribute('aria-pressed')).toBe('false')
  expect(toolbar().dataset.orientation).toBe('horizontal')
  expect(toolbar().style.visibility).toBe('')
  expect(toolbar().style.top).toBe('8px')
})

it('leaves out hidden items and keeps the orientation toggle', async () => {
  await renderDock({ panelDockHiddenItems: ['miniMap', 'companion', 'autoSaves', 'quickSaves', 'closeAll'] })
  expect(labels()).toEqual(['改为纵向排列'])
})

it('toggles a panel on every quick click and closes all panels at once', async () => {
  await renderDock()
  await act(async () => {
    button('迷你地图').click()
    button('迷你地图').click()
  })
  expect(current.miniMapEnabled).toBe(false)
  await act(async () => button('自动存档').click())
  expect(current.autoSavePanelEnabled).toBe(true)
  await act(async () => button('关闭全部迷你面板').click())
  expect(current).toMatchObject({ miniMapEnabled: false, companionEnabled: false, autoSavePanelEnabled: false, quickSavePanelEnabled: false, panelDockEnabled: true })
  expect(button('关闭全部迷你面板').disabled).toBe(true)
})

it('treats a panel closed by its own close button as not pressed, and shows it again on click', async () => {
  await renderDock({ miniMapEnabled: true })
  await act(async () => dismissMiniMap())
  expect(button('迷你地图').getAttribute('aria-pressed')).toBe('false')
  expect(button('关闭全部迷你面板').disabled).toBe(false)
  await act(async () => button('迷你地图').click())
  expect(update).not.toHaveBeenCalled()
  expect(button('迷你地图').getAttribute('aria-pressed')).toBe('true')
})

it('switches orientation from the bar', async () => {
  await renderDock()
  await act(async () => button('改为纵向排列').click())
  expect(current.panelDockOrientation).toBe('vertical')
  expect(toolbar().dataset.orientation).toBe('vertical')
  expect(labels().at(-1)).toBe('改为横向排列')
})

it('keeps the last moved position when the drag is cancelled', async () => {
  await renderDock()
  const grip = toolbar().querySelector('[role="separator"]') as HTMLElement
  Object.assign(grip, { setPointerCapture: jest.fn(), hasPointerCapture: () => true, releasePointerCapture: jest.fn() })
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    grip.dispatchEvent(event)
  }
  await act(async () => pointer('pointerdown', 600, 10))
  await act(async () => pointer('pointermove', 600, 110))
  await act(async () => pointer('pointercancel', 0, 0))
  expect(toolbar().style.top).toBe('108px')
  const saved = JSON.parse(localStorage.getItem('chaya.panelDock.frame.v1')!)
  expect(saved.y.mode).toBe('ratio')
  expect(saved.y.value).toBeCloseTo(100 / 884)
})

it('keeps focus on the game when clicked with the mouse and keeps game keys inside', async () => {
  await renderDock()
  const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  button('迷你地图').dispatchEvent(mouseDown)
  expect(mouseDown.defaultPrevented).toBe(true)
  const reached: string[] = []
  const onKey = (event: KeyboardEvent) => reached.push(event.key)
  document.addEventListener('keydown', onKey)
  for (const key of ['Enter', ' ', 'ArrowLeft', 'a']) button('迷你地图').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  document.removeEventListener('keydown', onKey)
  expect(reached).toEqual(['a'])
})

it('gives focus back to the game after a drag inside a shadow root', async () => {
  const shadowHost = document.createElement('div')
  document.body.appendChild(shadowHost)
  const shadow = shadowHost.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')
  shadow.appendChild(mount)
  const shadowRoot = createRoot(mount)
  await act(async () => shadowRoot.render(<Harness initial={{ ...DEFAULT_TOOL_SETTINGS, panelDockEnabled: true }} />))
  const grip = shadow.querySelector('[role="separator"]') as HTMLElement
  Object.assign(grip, { setPointerCapture: jest.fn(), hasPointerCapture: () => true, releasePointerCapture: jest.fn() })
  grip.focus()
  expect(document.activeElement).toBe(shadowHost)
  expect(shadow.activeElement).toBe(grip)
  const pointer = (type: string, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 600, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    grip.dispatchEvent(event)
  }
  await act(async () => pointer('pointerdown', 10))
  await act(async () => pointer('pointermove', 60))
  await act(async () => pointer('pointerup', 60))
  expect(shadow.activeElement).toBeNull()
  await act(async () => shadowRoot.unmount())
})

it('moves with the arrow keys on the grip and remembers the position', async () => {
  await renderDock()
  const grip = toolbar().querySelector('[role="separator"]') as HTMLElement
  await act(async () => grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })))
  expect(toolbar().style.top).toBe('38px')
  expect(JSON.parse(localStorage.getItem('chaya.panelDock.frame.v1')!)).toMatchObject({ y: { mode: 'top', value: 38 } })
})
