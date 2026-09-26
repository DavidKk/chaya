/**
 * @jest-environment node
 */
import { createTransCatchUp } from '@/plugins/src/translator/patch/apply-queue'

function installDb(partial: Record<string, unknown>) {
  const g = globalThis as any
  const keys = [
    '$dataActors',
    '$dataClasses',
    '$dataSkills',
    '$dataItems',
    '$dataWeapons',
    '$dataArmors',
    '$dataEnemies',
    '$dataStates',
    '$dataAnimations',
    '$dataTilesets',
    '$dataCommonEvents',
    '$dataTroops',
    '$dataSystem',
    '$dataMap',
    'SceneManager',
    'Window_Message',
    'Window_ScrollText',
  ]
  const prev: Record<string, unknown> = {}
  for (const key of keys) {
    prev[key] = g[key]
    g[key] = undefined
  }
  Object.assign(g, partial)
  return () => {
    for (const key of keys) {
      if (prev[key] === undefined) delete g[key]
      else g[key] = prev[key]
    }
  }
}

describe('createTransCatchUp', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('patches the DB in slices instead of one blocking sweep', () => {
    const actors = [null, { name: 'alice', description: 'desc' }, { name: 'bob' }, ...Array.from({ length: 50 }, (_, i) => ({ name: `n${i}` }))]
    const restore = installDb({
      $dataActors: actors,
      $dataCommonEvents: [],
      $dataTroops: [],
      $dataSystem: null,
      $dataMap: null,
    })
    const warnings: string[] = []
    const catchUp = createTransCatchUp({
      translate: (t) => `ZH:${t}`,
      log: { warn: (m) => warnings.push(String(m)) },
    })

    catchUp.scheduleCatchUp()
    expect(actors[1]?.name).toBe('alice')

    jest.advanceTimersByTime(32)
    expect(actors[1]?.name).toBe('ZH:alice')
    expect(actors[1]?.description).toBe('ZH:desc')
    expect(actors[2]?.name).toBe('ZH:bob')
    // One frame budget cannot finish every row
    expect(actors[actors.length - 1]?.name).toBe('n49')

    for (let i = 0; i < 10; i++) jest.advanceTimersByTime(16)
    expect(actors[actors.length - 1]?.name).toBe('ZH:n49')
    expect(warnings).toEqual([])
    restore()
  })

  it('rescheduling while running only queues one extra pass', () => {
    const items = Array.from({ length: 120 }, (_, i) => (i === 0 ? null : { name: `i${i}` }))
    const restore = installDb({
      $dataItems: items,
      $dataCommonEvents: [],
      $dataTroops: [],
      $dataSystem: null,
      $dataMap: null,
    })
    let calls = 0
    const catchUp = createTransCatchUp({
      translate: (t) => {
        calls += 1
        return `ZH:${t}`
      },
      log: { warn: () => {} },
    })

    catchUp.scheduleCatchUp()
    catchUp.scheduleCatchUp()
    catchUp.scheduleCatchUp()

    jest.advanceTimersByTime(32)
    const mid = calls
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(40)

    // Finish the full run (including a possible again pass)
    for (let i = 0; i < 40; i++) jest.advanceTimersByTime(16)
    expect(calls).toBeGreaterThanOrEqual(119)
    // At most two passes: 120 rows × 2
    expect(calls).toBeLessThanOrEqual(240)
    restore()
  })

  it('skips message/scroll windows on refresh; safe with no scene', () => {
    class MessageWin {
      refresh = jest.fn()
    }
    class ScrollWin {
      refresh = jest.fn()
    }
    class MenuWin {
      refresh = jest.fn()
    }
    const msg = new MessageWin()
    const scroll = new ScrollWin()
    const menu = new MenuWin()
    const restore = installDb({
      Window_Message: MessageWin,
      Window_ScrollText: ScrollWin,
      SceneManager: { _scene: { _windowLayer: { children: [msg, scroll, menu, null] } } },
    })
    const catchUp = createTransCatchUp({
      translate: (t) => t,
      log: { warn: () => {} },
    })
    catchUp.scheduleWindowRefresh()
    jest.advanceTimersByTime(600)
    expect(msg.refresh).not.toHaveBeenCalled()
    expect(scroll.refresh).not.toHaveBeenCalled()
    expect(menu.refresh).toHaveBeenCalledTimes(1)

    const restore2 = installDb({ SceneManager: { _scene: null } })
    expect(() => {
      catchUp.scheduleWindowRefresh()
      jest.advanceTimersByTime(600)
    }).not.toThrow()
    restore()
    restore2()
  })

  it('logs a warn and ends slicing when translate throws', () => {
    const actors = [null, { name: 'x' }]
    const restore = installDb({
      $dataActors: actors,
      $dataCommonEvents: [],
      $dataTroops: [],
      $dataSystem: null,
      $dataMap: null,
    })
    const warnings: string[] = []
    const catchUp = createTransCatchUp({
      translate: () => {
        throw new Error('boom')
      },
      log: { warn: (m) => warnings.push(String(m)) },
    })
    catchUp.scheduleCatchUp()
    for (let i = 0; i < 20; i++) jest.advanceTimersByTime(16)
    // Must match production Chinese log text
    expect(warnings.some((w) => w.includes('分片套用中断'))).toBe(true)
    restore()
  })
})
