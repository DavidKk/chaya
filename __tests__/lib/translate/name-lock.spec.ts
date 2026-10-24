import { planLockedNames, stitchLockedNamePlan } from '@/services/translate/name-lock'

describe('name-lock', () => {
  const entries = [{ src: 'Rei', zh: '蕾' }]

  it('composes possessive labels even when the old label is present in the name table', () => {
    const names = [...entries, { src: "Rei's Baby", zh: 'Rei的宝贝' }, { src: "Rei's mother.", zh: '丽伊的母亲。' }]
    const plan = planLockedNames("Rei's mother.", names)
    expect(plan?.spans.map((span) => [span.src, span.zh])).toEqual([["Rei's", '蕾的']])
    expect(plan?.translatable.map((gap) => gap.text)).toEqual([' mother.'])
    expect(stitchLockedNamePlan("Rei's mother.", plan!, new Map([['5:13', '母亲。']]))).toBe('蕾的母亲。')
    expect(planLockedNames("Rei's Baby", names)?.translatable.map((gap) => gap.text)).toEqual([' Baby'])
  })

  it("locks Rei's and leaves mother. as a translatable gap", () => {
    const plan = planLockedNames("Rei's mother.", entries)
    expect(plan?.spans.map((s) => [s.src, s.zh])).toEqual([["Rei's", '蕾的']])
    expect(plan?.translatable.map((g) => g.text)).toEqual([' mother.'])
    expect(plan?.wholeName).toBe(false)
    expect(stitchLockedNamePlan("Rei's mother.", plan!, new Map([['5:13', '母亲']]))).toBe('蕾的母亲')
  })

  it('treats a standalone name as a local stitch with no engine gap', () => {
    const plan = planLockedNames('Rei', entries)
    expect(plan?.wholeName).toBe(true)
    expect(plan?.translatable).toEqual([])
    expect(stitchLockedNamePlan('Rei', plan!, new Map())).toBe('蕾')
  })

  it('preserves literal spacing, line breaks, and spacing within translated gaps', () => {
    const names = [...entries, { src: 'Mia', zh: '米娅' }]
    const literal = planLockedNames('Rei  Mia', names)!
    expect(stitchLockedNamePlan('Rei  Mia', literal, new Map())).toBe('蕾  米娅')
    const src = "Rei's mother."
    const plan = planLockedNames(src, names)!
    expect(stitchLockedNamePlan(src, plan, new Map([['5:13', '母亲 平安']]))).toBe('蕾的母亲 平安')
    const multiline = "Rei's\nmother."
    const lines = planLockedNames(multiline, names)!
    expect(stitchLockedNamePlan(multiline, lines, new Map([['5:13', '母亲']]))).toBe('蕾的\n母亲')
  })

  it.each(['en', 'cht', 'zh-tw'])('does not apply simplified name locks to target %s', (targetLang) => {
    expect(planLockedNames("Rei's mother.", entries, { targetLang })).toBeNull()
  })
})
