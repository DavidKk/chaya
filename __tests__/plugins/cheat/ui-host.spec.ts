/** @jest-environment jsdom */

import { ensureGameEditHost } from '@/plugins/mv/src/cheat/ui/host'
import { restoreGameFocus } from '@/plugins/mv/src/helpers/ui/dom'

test('stops pointer events at the host boundary before they reach the game document', () => {
  const reached: string[] = []
  const gameListener = (event: Event) => reached.push(event.type)
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'contextmenu']) document.addEventListener(type, gameListener)

  const host = ensureGameEditHost('')
  const button = document.createElement('button')
  host.mount.appendChild(button)
  const buttonListener = jest.fn()
  button.addEventListener('mousedown', buttonListener)

  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'contextmenu'])
    button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 20 }))
  expect(buttonListener).toHaveBeenCalledTimes(1)
  expect(reached).toEqual([])

  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 30, clientY: 40 }))
  expect(reached).toEqual(['mousedown'])

  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'contextmenu']) document.removeEventListener(type, gameListener)
  host.remove()
})

test('keeps controls interactive while the host isolates their pointer events', () => {
  const host = ensureGameEditHost('')
  const input = document.createElement('input')
  host.mount.appendChild(input)
  const reached = jest.fn()
  document.addEventListener('mousedown', reached)

  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 })
  input.dispatchEvent(event)
  input.focus()

  expect(event.defaultPrevented).toBe(false)
  expect(host.shadow.activeElement).toBe(input)
  expect(reached).not.toHaveBeenCalled()

  document.removeEventListener('mousedown', reached)
  host.remove()
})

test('stops all keyboard events inside the overlay from bubbling to the game document', () => {
  const reachedKeys: string[] = []
  const gameKeyDown = (event: KeyboardEvent) => reachedKeys.push(`down:${event.key}`)
  const gameKeyUp = (event: KeyboardEvent) => reachedKeys.push(`up:${event.key}`)
  document.addEventListener('keydown', gameKeyDown)
  document.addEventListener('keyup', gameKeyUp)

  const host = ensureGameEditHost('')
  const input = document.createElement('input')
  const button = document.createElement('button')
  const panel = document.createElement('div')
  host.mount.appendChild(input)
  host.mount.appendChild(button)
  host.mount.appendChild(panel)

  const testKeys = ['Enter', 'Backspace', 'Delete', 'ArrowUp', ' ', 'a', 'z', 'Escape']
  for (const target of [input, button, panel]) {
    for (const key of testKeys) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }))
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }))
    }
  }

  expect(reachedKeys).toEqual([])

  // Keys outside the host must still reach the game document
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(reachedKeys).toEqual(['down:Enter'])

  document.removeEventListener('keydown', gameKeyDown)
  document.removeEventListener('keyup', gameKeyUp)
  host.remove()
})

test('ensures host and mount have no tabindex and enforce outline: none', () => {
  const host = ensureGameEditHost('')
  expect(host.host.hasAttribute('tabindex')).toBe(false)
  expect(host.host.style.outline).toBe('none')
  expect(host.mount.style.outline).toBe('none')
  host.remove()
})

test('restores focus from the hidden overlay to the canvas so Space reaches the game', () => {
  const host = ensureGameEditHost('')
  const input = document.createElement('input')
  host.mount.appendChild(input)
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  input.focus()
  expect(host.shadow.activeElement).toBe(input)
  host.setOpen(false)

  restoreGameFocus()

  expect(canvas.tabIndex).toBe(-1)
  expect(canvas.style.outline).toBe('none')
  expect(document.getElementById('chaya-no-focus-outline')).not.toBeNull()
  expect(document.activeElement).toBe(canvas)
  expect(host.shadow.activeElement).toBeNull()
  const gameKeyDown = jest.fn()
  document.addEventListener('keydown', gameKeyDown)
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }))
  expect(gameKeyDown).toHaveBeenCalledTimes(1)

  document.removeEventListener('keydown', gameKeyDown)
  host.remove()
  canvas.remove()
})

test('restores focus to the body when there is no game canvas', () => {
  const previousTabIndex = document.body.getAttribute('tabindex')
  const previousOutline = document.body.style.outline
  const host = ensureGameEditHost('')
  const input = document.createElement('input')
  host.mount.appendChild(input)
  input.focus()
  const windowFocus = jest.spyOn(window, 'focus').mockImplementation(() => {})

  restoreGameFocus()

  expect(document.activeElement).toBe(document.body)
  expect(host.shadow.activeElement).toBeNull()
  expect(document.body.tabIndex).toBe(-1)
  expect(document.body.style.outline).toBe('none')

  windowFocus.mockRestore()
  if (previousTabIndex === null) document.body.removeAttribute('tabindex')
  else document.body.setAttribute('tabindex', previousTabIndex)
  document.body.style.outline = previousOutline
  host.remove()
})

test('preserves an existing game canvas tab order when restoring focus', () => {
  const canvas = document.createElement('canvas')
  canvas.tabIndex = 0
  document.body.appendChild(canvas)

  restoreGameFocus()

  expect(canvas.tabIndex).toBe(0)
  expect(document.activeElement).toBe(canvas)
  canvas.remove()
})
