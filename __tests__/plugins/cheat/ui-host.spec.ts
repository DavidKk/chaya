/** @jest-environment jsdom */

import { ensureGameEditHost } from '@/plugins/mv/src/cheat/ui/host'

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
