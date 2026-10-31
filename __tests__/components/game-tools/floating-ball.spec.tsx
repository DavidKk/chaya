/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { RUN_FLAG_KEYS } from '@/components/game-edit/types'
import { FLOATING_BALL_SIZE, FLOATING_SHORTCUT_SIZE, floatingBallLayout } from '@/components/game-tools/floating-ball-layout'
import { FloatingBall, type FloatingBallRuntime, type FloatingBallSnapshot } from '@/components/game-tools/FloatingBall'
import { FLOATING_BALL_POSITION_KEY } from '@/components/game-tools/useFloatingBallPosition'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { DEFAULT_FLOATING_SHORTCUTS, normalizeFloatingShortcuts } from '@/lib/game-agent/floating-ball'
import { normalizeToolSettings } from '@/lib/game-agent/tool-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
let state: FloatingBallSnapshot
let runtime: FloatingBallRuntime
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const ball = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
const controls = () => host.querySelector('[role="group"]')

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
})
beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state = { ready: true, inBattle: false, flags: { autoBattle: false, autoWin: false, autotalk: false } }
  runtime = {
    read: jest.fn(() => ({ ...state, flags: { ...state.flags } })),
    execute: jest.fn((id) => {
      if (id === 'flag:autoBattle') state.flags.autoBattle = !state.flags.autoBattle
    }),
    restoreFocus: jest.fn(),
  }
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function render() {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <FloatingBall shortcuts={DEFAULT_FLOATING_SHORTCUTS} runtime={runtime} />
      </LocaleProvider>
    )
  )
}

it('migrates old settings, retains explicit empty lists and sanitizes ordered bindings', () => {
  expect(normalizeToolSettings({ miniMapEnabled: true })).toMatchObject({ floatingBallEnabled: false, floatingBallShortcuts: DEFAULT_FLOATING_SHORTCUTS })
  expect(normalizeFloatingShortcuts([])).toEqual([])
  expect(normalizeFloatingShortcuts(['flag:autoWin', 'action:scene:item', 'flag:autoWin', null, 'flag:nope', 'ui:toggle'])).toEqual(['flag:autoWin', 'action:scene:item'])
  expect(normalizeFloatingShortcuts(RUN_FLAG_KEYS.map((id) => `flag:${id}`))).toHaveLength(8)
})

it.each([
  [320, 568],
  [568, 240],
  [816, 624],
])('keeps eight separate controls inside a %s × %s viewport at every corner', (width, height) => {
  const area = { left: 12, top: 20, width, height }
  for (const x of [area.left, area.left + width - FLOATING_BALL_SIZE]) {
    for (const y of [area.top, area.top + height - FLOATING_BALL_SIZE]) {
      const layout = floatingBallLayout({ x, y }, 8, area)
      const slots = layout.slots.map((slot) => ({
        x: layout.x + slot.x * layout.scale,
        y: layout.y + slot.y * layout.scale,
        width: FLOATING_SHORTCUT_SIZE * layout.scale,
        height: FLOATING_SHORTCUT_SIZE * layout.scale,
      }))
      for (const [index, slot] of slots.entries()) {
        expect(slot.x).toBeGreaterThanOrEqual(area.left + 8)
        expect(slot.y).toBeGreaterThanOrEqual(area.top + 8)
        expect(slot.x + slot.width).toBeLessThanOrEqual(area.left + width - 8)
        expect(slot.y + slot.height).toBeLessThanOrEqual(area.top + height - 8)
        expect(slot.width).toBeGreaterThanOrEqual(40)
        for (const other of slots.slice(index + 1)) {
          expect(slot.x + slot.width <= other.x || other.x + other.width <= slot.x || slot.y + slot.height <= other.y || other.y + other.height <= slot.y).toBe(true)
        }
      }
    }
  }
})

it('reads flags when opened and re-reads before toggling, including external changes', async () => {
  await render()
  expect(runtime.read).not.toHaveBeenCalled()
  await act(async () => ball().click())
  expect(host.querySelector('[role="menu"]')).toBeNull()
  expect(controls()?.querySelectorAll('button')).toHaveLength(5)
  const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-pressed]')!
  expect(toggle().getAttribute('aria-pressed')).toBe('false')
  state.flags.autoBattle = true
  await act(async () => toggle().click())
  expect(runtime.execute).toHaveBeenCalledWith('flag:autoBattle')
  expect(state.flags.autoBattle).toBe(false)
  expect(toggle().getAttribute('aria-pressed')).toBe('false')
})

it('disables battle commands on the map and scene commands in battle', async () => {
  await render()
  await act(async () => ball().click())
  const actions = () => [...host.querySelectorAll<HTMLButtonElement>('[role="group"] button')].filter((node) => !node.hasAttribute('aria-pressed'))
  expect(actions()[0]!.disabled).toBe(true)
  expect(actions()[1]!.disabled).toBe(false)
  await act(async () => ball().click())
  state.inBattle = true
  await act(async () => ball().click())
  expect(actions()[0]!.disabled).toBe(false)
  expect(actions()[1]!.disabled).toBe(true)
})

it('executes a scene action directly and closes the controls with game focus restored', async () => {
  await render()
  await act(async () => ball().click())
  await act(async () => button('物品').click())
  expect(runtime.execute).toHaveBeenCalledWith('action:scene:item')
  expect(controls()).toBeNull()
  expect(runtime.restoreFocus).toHaveBeenCalledTimes(1)
})

it('rechecks action availability when the game enters battle after opening', async () => {
  await render()
  await act(async () => ball().click())
  state.inBattle = true
  await act(async () => button('物品').click())
  expect(runtime.execute).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('请先结束战斗')
})

it('isolates keys and Escape collapses the controls and returns game focus', async () => {
  await render()
  await act(async () => ball().click())
  const reached = jest.fn()
  document.addEventListener('keydown', reached)
  await act(async () => ball().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(controls()).toBeNull()
  expect(reached).not.toHaveBeenCalled()
  expect(runtime.restoreFocus).toHaveBeenCalled()
  document.removeEventListener('keydown', reached)
})

it('persists drag placement without opening or executing, then permits the next click', async () => {
  await render()
  const trigger = ball()
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    trigger.dispatchEvent(event)
  }
  await act(async () => pointer('pointerdown', 900, 400))
  await act(async () => pointer('pointermove', 600, 200))
  await act(async () => pointer('pointerup', 600, 200))
  await act(async () => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
  expect(controls()).toBeNull()
  expect(runtime.execute).not.toHaveBeenCalled()
  expect(runtime.restoreFocus).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem(FLOATING_BALL_POSITION_KEY)).not.toBeNull()
  await act(async () => trigger.click())
  expect(controls()).not.toBeNull()
})

it('handles native RGSS Escape before the main overlay and restores game focus', async () => {
  await render()
  const mainEscape = jest.fn()
  document.addEventListener('chaya:esc', mainEscape)
  try {
    await act(async () => ball().click())
    await act(async () => document.dispatchEvent(new Event('chaya:esc')))
    expect(controls()).toBeNull()
    expect(runtime.restoreFocus).toHaveBeenCalledTimes(1)
    expect(mainEscape).not.toHaveBeenCalled()
    ball().focus()
    await act(async () => document.dispatchEvent(new Event('chaya:esc')))
    expect(runtime.restoreFocus).toHaveBeenCalledTimes(2)
    expect(mainEscape).not.toHaveBeenCalled()
  } finally {
    document.removeEventListener('chaya:esc', mainEscape)
  }
})

it('prevents duplicate execution while pending and reports failures', async () => {
  let reject!: (error: Error) => void
  runtime.execute = jest.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail
      })
  )
  await render()
  await act(async () => ball().click())
  const action = host.querySelector<HTMLButtonElement>('[aria-pressed]')!
  action.focus()
  await act(async () => {
    action.click()
    action.click()
  })
  expect(runtime.execute).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(action)
  expect(action.getAttribute('aria-disabled')).toBe('true')
  await act(async () => reject(new Error('Game rejected command')))
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Game rejected command')
  expect(action.disabled).toBe(false)
})

it('leaves unsupported engine bindings visible and disabled', async () => {
  runtime.supports = (id) => id !== 'flag:autoBattle'
  await render()
  await act(async () => ball().click())
  expect(host.querySelector<HTMLButtonElement>('[aria-pressed]')!.disabled).toBe(true)
  expect(button('收起快捷功能')).toBeTruthy()
})

it('navigates the radial controls by keyboard while skipping disabled battle commands', async () => {
  await render()
  await act(async () => ball().click())
  expect(document.activeElement).toBe(button('物品'))
  await act(async () => button('物品').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(button('自动战斗'))
  await act(async () => button('自动战斗').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(button('自动对话'))
})

it('does not overwrite a completed toggle with an older asynchronous refresh', async () => {
  jest.useFakeTimers()
  try {
    await render()
    await act(async () => ball().click())
    let resolveOld!: (value: FloatingBallSnapshot) => void
    const old = { ...state, flags: { ...state.flags } }
    jest.mocked(runtime.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    await act(async () => {
      jest.advanceTimersByTime(600)
    })
    await act(async () => button('自动战斗').click())
    expect(button('自动战斗').getAttribute('aria-pressed')).toBe('true')
    await act(async () => resolveOld(old))
    expect(button('自动战斗').getAttribute('aria-pressed')).toBe('true')
  } finally {
    jest.useRealTimers()
  }
})
