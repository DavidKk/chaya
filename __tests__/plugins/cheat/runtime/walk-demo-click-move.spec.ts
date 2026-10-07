/** @jest-environment jsdom */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { DEFAULT_TOOL_SETTINGS, TOOL_SETTINGS_EVENT, TOOL_SETTINGS_STORAGE_KEY } from '@/lib/game-agent/tool-settings'
import { RunCheats } from '@/plugins/src/cheat/runtime/cheats-run'

const TILE = 48
const www = path.join(__dirname, '../../../../fixtures/game-walk/www')
const g = window as unknown as Record<string, any>

function noopContext() {
  return new Proxy({}, { get: (_t, key) => (key === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true })
}

function setSmartPath(on: boolean) {
  window.dispatchEvent(new CustomEvent(TOOL_SETTINGS_EVENT, { detail: { ...DEFAULT_TOOL_SETTINGS, smartPathEnabled: on } }))
}

beforeAll(() => {
  jest.useFakeTimers()
  HTMLCanvasElement.prototype.getContext = (() => noopContext()) as unknown as HTMLCanvasElement['getContext']
  document.body.innerHTML = '<canvas id="game" width="816" height="624"></canvas>'
  for (const file of ['data.js', 'objects.js', 'game.js']) new Function(readFileSync(path.join(www, file), 'utf8'))()
  g.startWalkDemo()
  RunCheats.ensureSmartPathHook()
})

afterAll(() => jest.useRealTimers())

const px = (tile: number) => tile * TILE + TILE / 2
const press = (x: number, y: number) => g.TouchInput._onTrigger(px(x), px(y))
const drag = (x: number, y: number) => g.TouchInput._onMove(px(x), px(y))
const release = () => g.TouchInput._onRelease()
const tap = (x: number, y: number) => {
  press(x, y)
  release()
}
const frames = (n: number) => jest.advanceTimersByTime((n * 1000) / 60 + 1)
const at = () => ({ x: g.$gamePlayer.x, y: g.$gamePlayer.y })

function walkThenRetarget() {
  g.$gamePlayer.locate(8, 9)
  tap(15, 9)
  frames(30)
  const turnedAt = at()
  expect(turnedAt.x).toBeGreaterThan(8)
  expect(turnedAt.x).toBeLessThan(15)
  tap(1, 10)
  frames(14)
  expect(g.$gamePlayer.x).toBeLessThanOrEqual(turnedAt.x + 1)
  frames(12 * 30)
  expect(at()).toEqual({ x: 1, y: 10 })
}

describe('walk demo click-to-move', () => {
  it('installs the smart path hook without any session state', () => {
    expect(g.__chayaSmartPath_v1__).toBe(true)
  })

  it('retargets to a new click while walking (smart path on)', () => {
    setSmartPath(true)
    walkThenRetarget()
  })

  it('retargets to a new click while walking (smart path off)', () => {
    setSmartPath(false)
    walkThenRetarget()
    setSmartPath(true)
  })

  it('retargets again while already detouring around the house', () => {
    g.$gamePlayer.locate(13, 6)
    tap(13, 1)
    frames(5 * 14)
    expect(g.$gameMap.mapId()).toBe(1)
    tap(8, 10)
    frames(40 * 14)
    expect(at()).toEqual({ x: 8, y: 10 })
  })

  it('walks around the long house instead of entering its door', () => {
    g.$gamePlayer.locate(13, 6)
    tap(13, 1)
    frames(40 * 14)
    expect(g.$gameMap.mapId()).toBe(1)
    expect(at()).toEqual({ x: 13, y: 1 })
  })
})

describe('walk demo press-and-drag', () => {
  afterEach(release)

  it('follows the pointer while the button stays held', () => {
    g.$gamePlayer.locate(8, 9)
    press(15, 9)
    frames(30)
    const turnedAt = at()
    expect(turnedAt.x).toBeGreaterThan(8)
    drag(1, 10)
    frames(12 * 30)
    expect(at()).toEqual({ x: 1, y: 10 })
  })

  it('waits 15 held frames before re-aiming, like RPG Maker', () => {
    g.$gamePlayer.locate(8, 9)
    press(15, 9)
    drag(1, 10)
    frames(5)
    expect(g.$gameTemp._destinationX).toBe(15)
    frames(15)
    expect(g.$gameTemp._destinationX).toBe(1)
  })

  it('routes around the house when dragged behind it', () => {
    g.$gamePlayer.locate(8, 9)
    press(10, 7)
    frames(20)
    drag(13, 1)
    frames(40 * 14)
    expect(g.$gameMap.mapId()).toBe(1)
    expect(at()).toEqual({ x: 13, y: 1 })
  })

  it('ignores pointer moves after the button is released', () => {
    g.$gamePlayer.locate(8, 9)
    press(15, 9)
    release()
    drag(1, 10)
    frames(12 * 30)
    expect(at()).toEqual({ x: 15, y: 9 })
  })
})

describe('walk demo smart path switch', () => {
  it('follows a switch flipped from another same-origin window via the storage event', () => {
    localStorage.setItem(TOOL_SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TOOL_SETTINGS, smartPathEnabled: false }))
    window.dispatchEvent(new StorageEvent('storage', { key: TOOL_SETTINGS_STORAGE_KEY }))
    g.$gamePlayer.locate(13, 6)
    tap(13, 1)
    frames(40 * 14)
    expect(g.$gameMap.mapId()).not.toBe(1)
  })
})
