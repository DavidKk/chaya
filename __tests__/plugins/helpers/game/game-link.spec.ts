/**
 * @jest-environment jsdom
 */
import { registerGameLinkEditHandlers } from '@/plugins/src/helpers/game/edit-link-bridge'
import { startGameLink, stopGameLink } from '@/plugins/src/helpers/game/game-link'

describe('helpers/game-link register and start/stop', () => {
  afterEach(() => {
    stopGameLink()
  })

  it('start without handlers is safe; second start is idempotent', () => {
    expect(() => startGameLink()).not.toThrow()
    expect(() => startGameLink()).not.toThrow()
    expect(() => stopGameLink()).not.toThrow()
  })

  it('registerGameLinkEditHandlers can replace; onStop runs on stop', () => {
    const onStop = jest.fn()
    const onMessage = jest.fn()
    registerGameLinkEditHandlers({ onMessage, onStop })
    startGameLink()
    stopGameLink()
    expect(onStop).toHaveBeenCalled()
  })
})
