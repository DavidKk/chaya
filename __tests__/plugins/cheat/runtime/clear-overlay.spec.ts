/**
 * @jest-environment jsdom
 */
import { RunCheats } from '@/plugins/src/cheat/runtime/cheats-run'

describe('RunCheats.clearOverlay / resumeAfterError', () => {
  const g = globalThis as Record<string, unknown>
  let canvas: HTMLCanvasElement
  let printer: HTMLDivElement
  let screen: Record<string, jest.Mock>
  let scene: { _fadeDuration: number; _fadeSprite: { opacity: number } }

  beforeEach(() => {
    canvas = document.createElement('canvas')
    // What Graphics.printError → _applyCanvasFilter leaves behind
    canvas.style.opacity = '0.5'
    canvas.style.filter = 'blur(8px)'
    printer = document.createElement('div')
    printer.innerHTML = '<font>TypeError</font>'
    screen = { startTint: jest.fn(), clearFlash: jest.fn(), clearFade: jest.fn(), clearShake: jest.fn(), changeWeather: jest.fn() }
    scene = { _fadeDuration: 12, _fadeSprite: { opacity: 200 } }
    Object.assign(g, {
      Graphics: { _canvas: canvas, _errorPrinter: printer, _errorShowed: true },
      $gameScreen: screen,
      SceneManager: { _scene: scene, _stopped: true, resume: jest.fn() },
    })
  })

  afterEach(() => {
    for (const key of ['Graphics', '$gameScreen', 'SceneManager']) delete g[key]
  })

  it('removes the error blur and every screen effect', () => {
    expect(RunCheats.clearOverlay()).toBe(true)
    expect(canvas.style.opacity).toBe('')
    expect(canvas.style.filter).toBe('')
    expect(printer.innerHTML).toBe('')
    expect((g.Graphics as { _errorShowed: boolean })._errorShowed).toBe(false)
    expect(screen.startTint).toHaveBeenCalledWith([0, 0, 0, 0], 0)
    expect(screen.clearFlash).toHaveBeenCalled()
    expect(screen.clearFade).toHaveBeenCalled()
    expect(screen.clearShake).toHaveBeenCalled()
    expect(screen.changeWeather).toHaveBeenCalledWith('none', 0, 0)
    expect(scene._fadeSprite.opacity).toBe(0)
  })

  it('resuming after an error also lifts the blur but keeps the error printer for later errors', () => {
    RunCheats.resumeAfterError()
    expect(canvas.style.filter).toBe('')
    expect(canvas.style.opacity).toBe('')
    expect((g.Graphics as { _errorPrinter: unknown })._errorPrinter).toBe(printer)
    expect((g.SceneManager as { _stopped: boolean })._stopped).toBe(false)
  })
})
