import { analyzeFlow, type FlowState, reachableFrom, variableCandidates } from '@/lib/game/events'

const c = (code: number, indent: number, parameters: unknown[] = []) => ({ code, indent, parameters })
const state = (over: Partial<FlowState> = {}): FlowState => ({ switches: {}, vars: {}, self: '', ...over })

// 0 if switch #1 ON / 1 text / 2 else / 3 text / 4 end / 5 text
const ifSwitch = [c(111, 0, [0, 1, 0]), c(101, 1), c(411, 0), c(101, 1), c(412, 0), c(101, 0)]

describe('analyzeFlow', () => {
  it('switch ON takes the then branch and skips else', () => {
    const r = analyzeFlow(ifSwitch, state({ switches: { 1: true } }))
    expect(r.conds[0]).toBe(true)
    expect(r.bodies).toEqual({ 0: 'run', 2: 'skip' })
    expect(r.marks).toEqual(['run', 'run', 'run', 'skip', 'run', 'run'])
  })

  it('switch OFF takes else', () => {
    const r = analyzeFlow(ifSwitch, state())
    expect(r.bodies).toEqual({ 0: 'skip', 2: 'run' })
    expect(r.marks[1]).toBe('skip')
    expect(r.marks[3]).toBe('run')
  })

  it('offline: both branches unknown', () => {
    const r = analyzeFlow(ifSwitch, null)
    expect(r.conds[0]).toBeNull()
    expect(r.bodies).toEqual({ 0: 'maybe', 2: 'maybe' })
    expect(r.marks[5]).toBe('run')
  })

  it('carries changes made earlier in the list', () => {
    const list = [c(121, 0, [1, 1, 0]), ...ifSwitch]
    expect(analyzeFlow(list, state()).bodies[1]).toBe('run')
  })

  it('choices are undecided; changes inside them make values unknown', () => {
    const list = [c(102, 0, [['a', 'b']]), c(402, 0, [0, 'a']), c(122, 1, [5, 5, 0, 0, 3]), c(402, 0, [1, 'b']), c(404, 0), c(111, 0, [1, 5, 0, 3, 0]), c(101, 1), c(412, 0)]
    const r = analyzeFlow(list, state({ vars: { 5: 1 } }))
    expect(r.bodies[1]).toBe('maybe')
    expect(r.marks[2]).toBe('maybe')
    expect(r.conds[5]).toBeNull()
    expect(r.marks[6]).toBe('maybe')
  })

  it('variable comparison and self switch', () => {
    const list = [c(111, 0, [1, 3, 0, 2, 1]), c(101, 1), c(412, 0), c(111, 0, [2, 'A', 0]), c(101, 1), c(412, 0)]
    const r = analyzeFlow(list, state({ vars: { 3: 2 }, self: 'A' }))
    expect(r.conds[0]).toBe(true)
    expect(r.conds[3]).toBe(true)
  })

  it('nested skip stays skipped', () => {
    const list = [c(111, 0, [0, 1, 0]), c(111, 1, [0, 2, 0]), c(101, 2), c(412, 1), c(412, 0)]
    const r = analyzeFlow(list, state({ switches: { 2: true } }))
    expect(r.marks[1]).toBe('skip')
    expect(r.marks[2]).toBe('skip')
  })

  it('common event calls, scripts and plugin commands make later values unknown', () => {
    for (const code of [117, 355, 356, 357]) {
      const r = analyzeFlow([c(code, 0, [1]), ...ifSwitch], state({ switches: { 1: true } }))
      expect(r.bodies[1]).toBe('maybe')
    }
    const reset = analyzeFlow([c(117, 0, [1]), c(121, 0, [1, 1, 0]), ...ifSwitch], state())
    expect(reset.bodies[2]).toBe('run')
  })

  it('gold and item changes carry into later conditions', () => {
    const gold = [c(125, 0, [1, 0, 50]), c(111, 0, [7, 100, 0]), c(101, 1), c(412, 0)]
    expect(analyzeFlow(gold, state({ gold: 120 })).conds[1]).toBe(false)
    expect(analyzeFlow(gold, state({ gold: 150 })).conds[1]).toBe(true)
    const item = [c(126, 0, [3, 0, 0, 1]), c(111, 0, [8, 3]), c(101, 1), c(412, 0)]
    expect(analyzeFlow(item, state({ itemCount: () => 0 })).conds[1]).toBe(true)
    expect(analyzeFlow(item, state()).conds[1]).toBeNull()
  })

  it('variable division floors like the game', () => {
    const list = [c(122, 0, [1, 1, 4, 0, 2]), c(111, 0, [1, 1, 0, -4, 0]), c(101, 1), c(412, 0)]
    expect(analyzeFlow(list, state({ vars: { 1: -7 } })).conds[1]).toBe(true)
  })
})

describe('reachableFrom', () => {
  const codes = (list: ReturnType<typeof c>[], from: number) => reachableFrom(list, from).map((x) => x.code)
  // 0 choices / 1 when a / 2 gold / 3 when b / 4 item / 5 end / 6 choices / 7 when x / 8 text / 9 end
  const choices = [c(102, 0), c(402, 0, [0]), c(125, 1), c(402, 0, [1]), c(126, 1), c(404, 0), c(102, 0), c(402, 0, [0]), c(101, 1), c(404, 0)]

  it('leaves out sibling choices but keeps later blocks', () => {
    expect(codes(choices, 1)).toEqual([402, 125, 404, 102, 402, 101, 404])
    expect(codes(choices, 4)).toEqual([126, 404, 102, 402, 101, 404])
  })

  it('then body skips else; starting on the if keeps both sides', () => {
    expect(codes(ifSwitch, 1)).toEqual([101, 412, 101])
    expect(codes(ifSwitch, 0)).toEqual(ifSwitch.map((x) => x.code))
    expect(codes(ifSwitch, 3)).toEqual([101, 412, 101])
  })
})

describe('variableCandidates', () => {
  it('collects compared and assigned constants', () => {
    const list = [c(111, 0, [1, 4, 0, 2, 0]), c(111, 0, [1, 4, 0, 1, 0]), c(122, 0, [4, 4, 0, 0, 3]), c(122, 0, [4, 4, 1, 0, 9]), c(111, 0, [1, 5, 0, 7, 0])]
    expect(variableCandidates(list, 4)).toEqual([1, 2, 3])
  })
})
