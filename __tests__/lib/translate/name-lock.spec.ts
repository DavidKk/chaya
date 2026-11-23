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

  it('treats alphanumeric codes and model suffixes like D3 as literal gaps in Japanese text', () => {
    const jpNames = [
      { src: 'エネミー', zh: '敌人' },
      { src: 'ボス', zh: '老板' },
      { src: '灯火', zh: '光' },
      { src: '移動：2F', zh: '移动：2楼' },
    ]
    const planD3 = planLockedNames('エネミーD3', jpNames, { sourceLang: 'ja' })!
    expect(planD3.spans.map((s) => [s.src, s.zh])).toEqual([['エネミー', '敌人']])
    expect(planD3.translatable).toEqual([])
    expect(stitchLockedNamePlan('エネミーD3', planD3, new Map())).toBe('敌人D3')

    const planA1 = planLockedNames('灯火-A1', jpNames, { sourceLang: 'ja' })!
    expect(planA1.translatable).toEqual([])
    expect(stitchLockedNamePlan('灯火-A1', planA1, new Map())).toBe('光-A1')

    const planBoss = planLockedNames('【Q201aボス】赤x2+僧', jpNames, { sourceLang: 'ja' })!
    expect(planBoss.spans.map((s) => [s.src, s.zh])).toEqual([['ボス', '老板']])
    expect(planBoss.translatable.map((g) => g.text)).toEqual(['】赤x2+僧'])
    expect(stitchLockedNamePlan('【Q201aボス】赤x2+僧', planBoss, new Map([['planBossGap', '】红x2+僧']]))).toBe('【Q201a老板】赤x2+僧')
  })

  it.each(['en', 'cht', 'zh-tw'])('does not apply simplified name locks to target %s', (targetLang) => {
    expect(planLockedNames("Rei's mother.", entries, { targetLang })).toBeNull()
  })
})
