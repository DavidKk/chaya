/**
 * @jest-environment node
 */
import { assertIdle, enclosingBranches, startCommonEventAt, startMapEventAt } from '@/plugins/src/cheat/session/run-from'

const c = (code: number, indent: number, parameters: unknown[] = []) => ({ code, indent, parameters })

// 0 text / 1 choices / 2 when「去森林」/ 3 switch / 4 text / 5 when「再想想」/ 6 text / 7 end / 8 if / 9 text / 10 else / 11 text / 12 end
const list = [
  c(101, 0),
  c(102, 0, [['去森林', '再想想']]),
  c(402, 0, [0, '去森林']),
  c(121, 1, [1, 1, 0]),
  c(101, 1),
  c(402, 0, [1, '再想想']),
  c(101, 1),
  c(404, 0),
  c(111, 0, [0, 1, 0]),
  c(101, 1),
  c(411, 0),
  c(101, 1),
  c(412, 0),
]

describe('cheat/run-from enclosingBranches', () => {
  it('top-level commands need no preset', () => {
    expect(enclosingBranches(list, 0)).toEqual({})
    expect(enclosingBranches(list, 1)).toEqual({})
  })

  it('starting on a choice branch enters it', () => {
    expect(enclosingBranches(list, 2)).toEqual({ 0: 0 })
    expect(enclosingBranches(list, 5)).toEqual({ 0: 1 })
  })

  it('starting inside a branch body presets its parent', () => {
    expect(enclosingBranches(list, 4)).toEqual({ 0: 0 })
    expect(enclosingBranches(list, 6)).toEqual({ 0: 1 })
  })

  it('else body marks the condition false; then body needs nothing', () => {
    expect(enclosingBranches(list, 11)).toEqual({ 0: false })
    expect(enclosingBranches(list, 9)).toEqual({})
  })
})

describe('cheat/run-from start', () => {
  const g = globalThis as Record<string, unknown>
  let running = false
  const interpreter = {
    _index: 0,
    _branch: {} as Record<number, unknown>,
    _eventId: 0,
    isRunning: () => running,
    setup(_list: unknown[], eventId = 0) {
      this._index = 0
      this._branch = {}
      this._eventId = eventId
    },
  }

  beforeEach(() => {
    running = false
    g.$gameMap = { _interpreter: interpreter }
    g.$dataCommonEvents = [null, { list }]
    g.$dataMap = { events: [null, { pages: [{ list: [c(101, 0)] }, { list }] }] }
  })
  afterAll(() => {
    for (const k of ['$gameMap', '$dataCommonEvents', '$dataMap']) delete g[k]
  })

  it('sets the index and enters the enclosing branch', () => {
    startCommonEventAt(1, 6)
    expect(interpreter._index).toBe(6)
    expect(interpreter._branch).toEqual({ 0: 1 })
    startMapEventAt(1, 1, 11)
    expect(interpreter._eventId).toBe(1)
    expect(interpreter._branch).toEqual({ 0: false })
  })

  it('rejects while busy, bad positions, missing pages and engines without an interpreter', () => {
    running = true
    expect(() => assertIdle()).toThrow('有事件正在执行')
    expect(() => startCommonEventAt(1, 2)).toThrow('有事件正在执行')
    running = false
    expect(() => startCommonEventAt(1, 99)).toThrow('指令位置无效')
    expect(() => startMapEventAt(1, 5, 0)).toThrow('没有第 6 页')
    g.$gameMap = {}
    expect(() => startCommonEventAt(1, 0)).toThrow('不支持从指定行执行')
  })
})
