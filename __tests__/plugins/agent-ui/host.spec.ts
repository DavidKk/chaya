/** @jest-environment jsdom */

import { ensureGameAgentHost } from '@/plugins/src/agent-ui/host'

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
