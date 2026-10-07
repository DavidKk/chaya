/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { type MiniPanelId, TOOL_PANEL_FRAME } from '@/components/game-tools/tool-panels'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

const MAP_KEY = TOOL_PANEL_FRAME.miniMap.storageKey
let root: Root
let host: HTMLDivElement

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function panel(title: string, id: MiniPanelId) {
  return (
    <FloatingToolPanel title={title} panel={id} onClose={jest.fn()} scrollContent={false}>
      Content
    </FloatingToolPanel>
  )
}

async function renderPanels(two = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        {panel('Map', 'miniMap')}
        {two && panel('Companion', 'companion')}
      </LocaleProvider>
    )
  })
}

function frame(title: string) {
  const element = document.querySelector(`section[aria-label="${title}"]`) as HTMLElement
  return { x: parseFloat(element.style.left), y: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.height) }
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

beforeEach(() => {
  setViewport(1200, 900)
  localStorage.clear()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
})

test('keeps a right-anchored panel visible and restores its saved size after a narrow viewport', async () => {
  localStorage.setItem(MAP_KEY, JSON.stringify({ version: 2, width: 400, height: 450, x: { mode: 'right', value: 20 }, y: { mode: 'top', value: 24 } }))
  await renderPanels()
  expect(frame('Map')).toEqual({ x: 780, y: 24, width: 400, height: 450 })

  await act(async () => {
    setViewport(300, 280)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map')).toEqual({ x: 8, y: 8, width: 284, height: 264 })
  expect(JSON.parse(localStorage.getItem(MAP_KEY)!).width).toBe(400)

  await act(async () => {
    setViewport(1200, 900)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map')).toEqual({ x: 780, y: 24, width: 400, height: 450 })
})

test('keeps a manually placed panel at its relative position across viewport changes', async () => {
  localStorage.setItem(MAP_KEY, JSON.stringify({ version: 2, width: 320, height: 360, x: { mode: 'ratio', value: 0.25 }, y: { mode: 'ratio', value: 0.6 } }))
  await renderPanels()
  expect(frame('Map').x).toBe(224)
  expect(frame('Map').y).toBeCloseTo(322.4)

  await act(async () => {
    setViewport(800, 600)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map').x).toBe(124)
  expect(frame('Map').y).toBeCloseTo(142.4)
})

test('migrates a saved absolute frame into a relative layout', async () => {
  localStorage.setItem(MAP_KEY, JSON.stringify({ x: 350, y: 200, width: 320, height: 360 }))
  await renderPanels()
  expect(frame('Map')).toEqual({ x: 350, y: 200, width: 320, height: 360 })

  await act(async () => {
    setViewport(800, 600)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map').x).toBeGreaterThan(8)
  expect(frame('Map').x + frame('Map').width).toBeLessThan(800)
  expect(frame('Map').y + frame('Map').height).toBeLessThan(600)
})

test('pinning locks position and size; the old opaque pin flag is ignored', async () => {
  Object.assign(HTMLElement.prototype, { setPointerCapture: jest.fn(), hasPointerCapture: jest.fn(() => false), releasePointerCapture: jest.fn() })
  localStorage.setItem(`${MAP_KEY}.pinned`, 'true')
  await renderPanels()
  const section = document.querySelector('section[aria-label="Map"]') as HTMLElement
  const header = section.firstElementChild as HTMLElement
  const drag = async (dx: number) => {
    await act(async () => {
      header.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
      header.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100 + dx, clientY: 100 }))
      header.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100 + dx, clientY: 100 }))
    })
  }
  expect(section.dataset.pinned).toBe('false')
  expect(section.querySelectorAll('[role="separator"]')).toHaveLength(8)
  const before = frame('Map').x
  await drag(-50)
  expect(frame('Map').x).toBe(before - 50)

  const pin = section.querySelector('button[aria-pressed]') as HTMLButtonElement
  await act(async () => pin.click())
  expect(pin.getAttribute('aria-pressed')).toBe('true')
  expect(localStorage.getItem(`${MAP_KEY}.locked`)).toBe('true')
  expect(section.querySelectorAll('[role="separator"]')).toHaveLength(0)
  await drag(-50)
  expect(frame('Map').x).toBe(before - 50)
  expect(section.className).not.toContain('opacity-40')
})

test('stacks the two panels at screen edges when the viewport is too short', async () => {
  await renderPanels(true)
  await act(async () => {
    setViewport(360, 480)
    window.dispatchEvent(new Event('resize'))
  })
  const map = frame('Map')
  const companion = frame('Companion')
  expect(map).toEqual({ x: 24, y: 8, width: 320, height: 228 })
  expect(companion).toEqual({ x: 44, y: 244, width: 300, height: 228 })
  expect(map.y + map.height).toBeLessThan(companion.y)

  await act(async () => {
    setViewport(1200, 900)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map').height).toBe(TOOL_PANEL_FRAME.miniMap.defaultSize.height)
  expect(frame('Companion').height).toBe(TOOL_PANEL_FRAME.companion.defaultSize.height)
  expect(frame('Companion').y).toBe(900 - 16 - TOOL_PANEL_FRAME.companion.defaultSize.height)
})
