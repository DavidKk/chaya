/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

const size = { width: 320, height: 360 }
const minSize = { width: 240, height: 180 }
const maxSize = { width: 600, height: 700 }
let root: Root
let host: HTMLDivElement

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function panel(title: string, edge: 'top' | 'bottom') {
  return (
    <FloatingToolPanel
      title={title}
      storageKey={`test.${title}`}
      initialEdge={edge}
      defaultSize={size}
      minSize={minSize}
      maxSize={maxSize}
      onClose={jest.fn()}
      scrollContent={false}
    >
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
        {panel('Map', 'top')}
        {two && panel('Companion', 'bottom')}
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
  localStorage.setItem('test.Map', JSON.stringify({ version: 2, width: 400, height: 450, x: { mode: 'right', value: 20 }, y: { mode: 'top', value: 24 } }))
  await renderPanels()
  expect(frame('Map')).toEqual({ x: 780, y: 24, width: 400, height: 450 })

  await act(async () => {
    setViewport(300, 280)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map')).toEqual({ x: 8, y: 8, width: 284, height: 264 })
  expect(JSON.parse(localStorage.getItem('test.Map')!).width).toBe(400)

  await act(async () => {
    setViewport(1200, 900)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map')).toEqual({ x: 780, y: 24, width: 400, height: 450 })
})

test('keeps a manually placed panel at its relative position across viewport changes', async () => {
  localStorage.setItem('test.Map', JSON.stringify({ version: 2, width: 320, height: 360, x: { mode: 'ratio', value: 0.25 }, y: { mode: 'ratio', value: 0.6 } }))
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
  localStorage.setItem('test.Map', JSON.stringify({ x: 350, y: 200, width: 320, height: 360 }))
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

test('stacks the two panels at screen edges when the viewport is too short', async () => {
  await renderPanels(true)
  await act(async () => {
    setViewport(360, 480)
    window.dispatchEvent(new Event('resize'))
  })
  const map = frame('Map')
  const companion = frame('Companion')
  expect(map).toEqual({ x: 24, y: 8, width: 320, height: 228 })
  expect(companion).toEqual({ x: 24, y: 244, width: 320, height: 228 })
  expect(map.y + map.height).toBeLessThan(companion.y)

  await act(async () => {
    setViewport(1200, 900)
    window.dispatchEvent(new Event('resize'))
  })
  expect(frame('Map').height).toBe(360)
  expect(frame('Companion').height).toBe(360)
  expect(frame('Companion').y).toBe(524)
})
