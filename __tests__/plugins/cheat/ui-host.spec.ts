/** @jest-environment jsdom */

import { ensureGameEditHost } from '@/plugins/src/cheat/ui/host'

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
