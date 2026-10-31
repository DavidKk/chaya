/**
 * @jest-environment jsdom
 */
import { ensureAutoTalkFallback, getAutoTalk, setAutoTalk } from "@/plugins/mv/src/cheat/runtime/auto-talk"

describe("auto-talk runtime hooks", () => {
  let fakeWindowMessage: any
  let fakeGameMessage: any

  beforeEach(() => {
    fakeGameMessage = {
      isChoice: jest.fn(() => false),
      isNumberInput: jest.fn(() => false),
      isItemChoice: jest.fn(() => false),
    }
    ;(globalThis as any).$gameMessage = fakeGameMessage

    fakeWindowMessage = function () {
      this.pause = false
      this._waitCount = 0
      this._showFast = false
      this._textState = null
      this.terminateMessage = jest.fn()
      this.isAnySubWindowActive = jest.fn(() => false)
    }
    fakeWindowMessage.prototype = {
      updateShowFast: jest.fn(function () {}),
      updateWait: jest.fn(function () {
        return this._waitCount > 0
      }),
      updateInput: jest.fn(function () {
        return this.pause
      }),
      isTriggered: jest.fn(function () {
        return false
      }),
    }
    ;(globalThis as any).Window_Message = fakeWindowMessage
    ;(globalThis as any).Input = { update: jest.fn() }
  })

  afterEach(() => {
    setAutoTalk(false)
    delete (globalThis as any).Window_Message
    delete (globalThis as any).$gameMessage
    delete (globalThis as any).Input
  })

  it("toggles auto-talk state on and off", () => {
    expect(getAutoTalk()).toBe(false)
    setAutoTalk(true)
    expect(getAutoTalk()).toBe(true)
    setAutoTalk(false)
    expect(getAutoTalk()).toBe(false)
  })

  it("hooks updateShowFast and sets _showFast to true when auto-talk is active", () => {
    ensureAutoTalkFallback()
    setAutoTalk(true)

    const win = new (fakeWindowMessage as any)()
    expect(win._showFast).toBe(false)
    win.updateShowFast()
    expect(win._showFast).toBe(true)

    setAutoTalk(false)
    win._showFast = false
    win.updateShowFast()
    expect(win._showFast).toBe(false)
  })

  it("hooks updateWait and cancels inline _waitCount when auto-talk is active and not paused", () => {
    ensureAutoTalkFallback()
    setAutoTalk(true)

    const win = new (fakeWindowMessage as any)()
    win.pause = false
    win._waitCount = 30
    win.updateWait()
    expect(win._waitCount).toBe(0)
    expect(win._showFast).toBe(true)
  })

  it("hooks updateInput and auto-advances dialogue when paused and no choices are active", () => {
    ensureAutoTalkFallback()
    setAutoTalk(true)

    const win = new (fakeWindowMessage as any)()
    win.pause = true

    // Count down the 12 frames
    for (let i = 0; i < 11; i++) {
      const handled = win.updateInput()
      expect(win.pause).toBe(true)
      expect(handled).toBe(true)
    }

    // On 12th frame, pause is cleared and message terminated
    const handled = win.updateInput()
    expect(win.pause).toBe(false)
    expect(win.terminateMessage).toHaveBeenCalled()
    expect(handled).toBe(true)
  })

  it("does not advance dialogue when choices or subwindows are active", () => {
    ensureAutoTalkFallback()
    setAutoTalk(true)

    fakeGameMessage.isChoice.mockReturnValue(true)
    const win = new (fakeWindowMessage as any)()
    win.pause = true

    for (let i = 0; i < 20; i++) {
      win.updateInput()
      expect(win.pause).toBe(true)
      expect(win.terminateMessage).not.toHaveBeenCalled()
    }
  })
})
