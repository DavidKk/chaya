/** @jest-environment jsdom */
import { ensureGameAgentHost } from '@/plugins/mv/src/agent-ui/host'
import { startGameAgentHotkeys } from '@/plugins/mv/src/agent-ui/hotkeys'
import { isGameAgentUiOpen, showGameAgentUi, unmountGameAgentUi } from '@/plugins/mv/src/agent-ui/mount'

const TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel']

test('keeps clicks on the companion panel from reaching the game touch input', () => {
  const reached: string[] = []
  const gameListener = (event: Event) => reached.push(event.type)
  for (const type of TYPES) document.addEventListener(type, gameListener)

  const { mount } = ensureGameAgentHost('')
  ensureGameAgentHost('')
  const button = document.createElement('button')
  mount.appendChild(button)
  const clicked = jest.fn()
  button.addEventListener('click', clicked)

  for (const type of TYPES) button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true }))
  expect(clicked).toHaveBeenCalledTimes(1)
  expect(reached).toEqual([])

  document.body.dispatchEvent(new Event('mousedown', { bubbles: true, composed: true }))
  expect(reached).toEqual(['mousedown'])

  for (const type of TYPES) document.removeEventListener(type, gameListener)
})

test('stops companion panel keyboard events from bubbling to the game document', () => {
  const reachedKeys: string[] = []
  const gameKeyDown = (event: KeyboardEvent) => reachedKeys.push(`down:${event.key}`)
  const gameKeyUp = (event: KeyboardEvent) => reachedKeys.push(`up:${event.key}`)
  document.addEventListener('keydown', gameKeyDown)
  document.addEventListener('keyup', gameKeyUp)

  const { mount } = ensureGameAgentHost('')
  const input = document.createElement('input')
  const button = document.createElement('button')
  mount.appendChild(input)
  mount.appendChild(button)

  for (const key of ['Enter', 'Backspace', 'ArrowDown', ' ', 'a']) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }))
    button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }))
    button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }))
  }

  expect(reachedKeys).toEqual([])
  document.removeEventListener('keydown', gameKeyDown)
  document.removeEventListener('keyup', gameKeyUp)
})

test('removes a stale host tabindex when reusing the companion overlay', () => {
  const { host } = ensureGameAgentHost('')
  host.tabIndex = -1

  const reused = ensureGameAgentHost('')

  expect(reused.host).toBe(host)
  expect(host.hasAttribute('tabindex')).toBe(false)
  expect(host.style.outline).toBe('none')
  expect(reused.mount.style.outline).toBe('none')
})

test('startGameAgentHotkeys blurs focused input on first Escape, then closes on second Escape', () => {
  const focusSpy = jest.spyOn(window, 'focus').mockImplementation(() => {})

  const dispose = startGameAgentHotkeys()
  showGameAgentUi()
  expect(isGameAgentUiOpen()).toBe(true)

  const input = document.createElement('input')
  document.body.appendChild(input)
  input.focus()
  expect(document.activeElement).toBe(input)

  // 1. Press Escape while input is focused -> should blur input, UI remains open
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(document.activeElement).not.toBe(input)
  expect(isGameAgentUiOpen()).toBe(true)

  // 2. Press Escape again -> should close UI
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(isGameAgentUiOpen()).toBe(false)

  input.remove()
  dispose()
  unmountGameAgentUi()
  focusSpy.mockRestore()
})
