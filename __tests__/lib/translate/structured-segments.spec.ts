import { planSentenceTranslation, renderSentencePlan, validateAlignments } from '@/lib/translate/sentence-plan'
import { sentenceUnits } from '@/lib/translate/sentence-units'
import { scanStructuredText, validRecordStructure } from '@/lib/translate/structured-segments'

const bodies = (s: string) => scanStructuredText(s).units.map((u) => s.slice(u.start, u.end))
it.each([
  '条件：①等级60以上 ②完成委托',
  '条件：①等级60以上②完成委托',
  '条件：1. 等级60以上 2. 完成委托',
  '条件：１、等级60以上 ２、完成委托',
  '条件：(1)等级60以上 (2)完成委托',
  '条件：i. 等级60以上 ii. 完成委托',
  '条件：I. 等级60以上 II. 完成委托',
  '条件：Ⅰ等级60以上 Ⅱ完成委托',
  '条件：\n1. 等级60以上\r\n2. 完成委托',
])('keeps complete list items and reconstructs %s', (s) => {
  const parsed = scanStructuredText(s)
  expect(bodies(s)).toEqual(['条件', '等级60以上', '完成委托'])
  expect(parsed.units.every((u) => u.state === 'accepted')).toBe(true)
  expect(parsed.layout.map((part) => s.slice(part.start, part.end)).join('')).toBe(s)
})
it('recognizes noun items and distinguishes ambiguous middle dots', () => {
  expect(bodies('属性：力量·敏捷·智力')).toEqual(['属性', '力量', '敏捷', '智力'])
  expect(scanStructuredText('作者：约翰·史密斯').units).toEqual([])
  expect(scanStructuredText('作者：约翰·史密斯·琼斯').units.every((u) => u.state === 'suggested')).toBe(true)
})
it.each(['伤害提高1.5倍', '版本1.2.3', 'VIP II', '最终幻想 VII', '等级60以上', '时间12:30', 'https://host/1.2.3', '「1. 甲 2. 乙」'])('does not split ordinary text %s', (s) => {
  expect(bodies(s)).toEqual([])
})
it('requires confirmation for weak or invalid numbering', () => {
  for (const text of ['说明：1是什么 2是什么', '奖励：i 金币 ii 装备', '条件：1. 甲 3. 乙']) {
    expect(scanStructuredText(text).units.every((u) => u.state === 'suggested')).toBe(true)
    expect(scanStructuredText(text, { mode: 'accept' }).units.every((u) => u.state === 'accepted')).toBe(true)
  }
})
it('leaves protected control scopes intact', () => {
  const text = String.raw`条件：①\C[2]等级60以上 ②完成委托`
  expect(scanStructuredText(text)).toMatchObject({ units: [], diagnostics: [{ code: 'protected_token' }] })
})
it('matches item caches without changing list separators or fabricating subtranslations', () => {
  const src = '条件：①等级60以上 ②完成委托'
  const records = [
    ['条件', 'Conditions'],
    ['等级60以上', 'Level 60 or above'],
    ['完成委托', 'Finish quest'],
  ].map(([src, zh]) => ({ id: src, revision: 1, src, zh }))
  expect(planSentenceTranslation(src, records)).toMatchObject({ status: 'full', zh: 'Conditions：①Level 60 or above ②Finish quest' })
  expect(planSentenceTranslation(src, records.slice(1))).toMatchObject({ status: 'partial', zh: null, gaps: [{ text: '条件' }] })
  expect(planSentenceTranslation('等级60以上', [{ id: 'parent', revision: 1, src, zh: 'Conditions: 1. Level 60 or above 2. Finish quest' }])).toMatchObject({
    status: 'full',
    zh: 'Level 60 or above',
  })
})

it('reuses the label and final numbered item while preserving the uncached middle item', () => {
  const src = '解放条件：①レベル60以上 ②再度VIP特典の仕事をする'
  const plan = planSentenceTranslation(src, [
    {
      id: 'message',
      revision: 1,
      src: 'EV12は未解放です。\n解放条件：①淫乱度60以上、②再度VIP特典の仕事をする',
      zh: 'EV12未解锁。\n解锁条件：①淫乱度60以上 ②再次进行VIP特典工作',
      engine: 'import',
    },
    { id: 'list', revision: 1, src: '解放条件：①淫乱度60以上、②再度VIP特典の仕事をする', zh: '解放条件：①.淫乱度60以上 ②.再次进行VIP特典工作', engine: 'import' },
  ])
  expect(plan.status).toBe('partial')
  expect(plan.matches.map((match) => src.slice(match.start, match.end))).toEqual(['解放条件', '再度VIP特典の仕事をする'])
  expect(plan.gaps.map((gap) => gap.text)).toEqual(['レベル60以上'])
  expect(renderSentencePlan(plan)).toBe('解放条件：①レベル60以上 ②再次进行VIP特典工作')
})
it('keeps each list entry in a separate block and validates explicit body alignment', () => {
  const src = '条件：①等级60以上 ②完成委托',
    zh = 'Conditions: 1. Level 60 or above 2. Finish quest'
  const a = sentenceUnits(src),
    b = sentenceUnits(zh)
  const groups = a.map((u, i) => ({ sourceStart: u.start, sourceEnd: u.end, targetStart: b[i].start, targetEnd: b[i].end, evidence: 'verified' as const }))
  expect(new Set(a.map((u) => u.block)).size).toBe(3)
  expect(validateAlignments({ src, zh }, groups)).toBe(true)
  expect(planSentenceTranslation('等级60以上', [{ id: 'parent', revision: 1, src, zh, alignments: groups }]).zh).toBe('Level 60 or above')
})

it('preserves preamble, emoji and punctuation while reusing complete punctuated items', () => {
  const src = 'EV12は未解放です。\n解放条件：①レベル60以上、②依頼を完了する。'
  const parsed = scanStructuredText(src)
  expect(parsed.units.map((u) => src.slice(u.start, u.end))).toEqual(['EV12は未解放です。', '解放条件', 'レベル60以上', '依頼を完了する。'])
  expect(parsed.layout.map((p) => src.slice(p.start, p.end)).join('')).toBe(src)
  const plan = planSentenceTranslation('条件：①完了！ ②😀獲得。', [
    { id: 'a', revision: 1, src: '条件', zh: 'Conditions' },
    { id: 'b', revision: 1, src: '完了！', zh: 'Done!' },
    { id: 'c', revision: 1, src: '😀獲得。', zh: 'Got 😀.' },
  ])
  expect(plan).toMatchObject({ status: 'full', zh: 'Conditions：①Done! ②Got 😀.' })
})

it('supports explicit bullets without inventing an empty first item', () => {
  for (const text of ['材料：• 铁矿石 • 木材', '材料：\n• 铁矿石\n• 木材']) {
    const parsed = scanStructuredText(text)
    expect(parsed.units.map((u) => text.slice(u.start, u.end))).toEqual(['材料', '铁矿石', '木材'])
    expect(parsed.units.every((u) => u.state === (text.includes('\n') ? 'accepted' : 'suggested'))).toBe(true)
  }
  expect(validRecordStructure({ source: null })).toBe(false)
  expect(validRecordStructure({ source: false })).toBe(false)
})
