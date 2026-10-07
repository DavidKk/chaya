import { readCommandInputs, readRenderedText, startRenderedTextCapture } from '@/plugins/src/agent/rendered-text'

type TestContext = { canvas: { isConnected: boolean }; fillText: (text: string, x: number, y: number) => void; strokeText: (text: string, x: number, y: number) => void }

describe('rendered canvas text', () => {
  const globals = globalThis as typeof globalThis & { CanvasRenderingContext2D?: { prototype: TestContext }; SceneManager?: { _scene: object } }
  const originalContext = globals.CanvasRenderingContext2D
  const originalScenes = globals.SceneManager
  let now: number
  let stop: () => void
  let context: TestContext
  let originalFill: TestContext['fillText']

  beforeEach(() => {
    now = 1_000
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    const prototype = { fillText: jest.fn(), strokeText: jest.fn() } as unknown as TestContext
    originalFill = prototype.fillText
    globals.CanvasRenderingContext2D = { prototype }
    globals.SceneManager = { _scene: {} }
    context = Object.create(prototype) as TestContext
    context.canvas = { isConnected: true }
    stop = startRenderedTextCapture()
  })

  afterEach(() => {
    stop()
    jest.restoreAllMocks()
    if (originalContext === undefined) delete globals.CanvasRenderingContext2D
    else globals.CanvasRenderingContext2D = originalContext
    if (originalScenes === undefined) delete globals.SceneManager
    else globals.SceneManager = originalScenes
  })

  it('reads displayed text, deduplicates it and expires old frames', () => {
    context.fillText('  森林遭遇  ', 10, 20)
    context.strokeText('森林遭遇', 10, 20)
    expect(readRenderedText()).toEqual({ visible: ['森林遭遇'], recentBitmap: [] })
    now += 1_001
    expect(readRenderedText()).toEqual({ visible: [], recentBitmap: [] })
  })

  it('separates offscreen bitmap text and clears both buffers on a scene change', () => {
    context.canvas.isConnected = false
    context.fillText('敌人名称', 10, 20)
    context.canvas.isConnected = true
    context.fillText('战斗', 10, 20)
    expect(readRenderedText()).toEqual({ visible: ['战斗'], recentBitmap: ['敌人名称'] })
    globals.SceneManager!._scene = {}
    expect(readRenderedText()).toEqual({ visible: [], recentBitmap: [] })
  })

  it('updates animated text at one drawing position without evicting other labels', () => {
    context.fillText('森林遭遇', 20, 20)
    for (let remaining = 700; remaining > 0; remaining -= 16) {
      context.fillText(`剩余 ${remaining} ms`, 310, 335)
      now += 16
    }
    expect(readRenderedText().visible).toEqual(['森林遭遇', '剩余 12 ms'])
  })

  it('pairs command-input arrow rows with the skill name above them', () => {
    context.canvas.isConnected = false
    context.fillText('★セイバー', 30, 90)
    context.fillText('→ ←', 64, 128)
    context.fillText('★クロスセイバー', 286, 44)
    context.fillText('→', 318, 80)
    context.fillText('↑', 366, 81)
    context.fillText('←', 412, 80)
    context.fillText('10', 184, 304)
    context.fillText('★ホーリー', 30, 300)
    context.fillText('← →', 64, 336)
    expect(readCommandInputs()).toEqual([
      { label: '★クロスセイバー', keys: ['right', 'up', 'left'] },
      { label: '★セイバー', keys: ['right', 'left'] },
      { label: '★ホーリー', keys: ['left', 'right'] },
    ])
  })

  it('reports no commands for plain menu text or after a scene change', () => {
    context.fillText('攻撃 → 敵', 10, 20)
    expect(readCommandInputs()).toEqual([])
    context.fillText('↑ ↓', 10, 40)
    globals.SceneManager!._scene = {}
    expect(readCommandInputs()).toEqual([])
  })

  it('restores canvas methods on shutdown', () => {
    const prototype = globals.CanvasRenderingContext2D!.prototype
    stop()
    expect(prototype.fillText).toBe(originalFill)
    context.fillText('卸载后', 10, 20)
    expect(readRenderedText()).toEqual({ visible: [], recentBitmap: [] })
  })
})
