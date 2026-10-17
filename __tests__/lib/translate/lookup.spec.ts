import { type GlossaryEntry, indexGlossaryTemplate, maskGlossary, translateByGlossaryTemplate } from '@/lib/translate/glossary-mask'
import {
  compactTranslateKey,
  indexTrailingStem,
  invalidateWhitespaceLookup,
  lookupTranslationRecord,
  normalizeTranslateKey,
  trailingNumberParts,
  translateWithLookup,
} from '@/lib/translate/lookup'
import { toRmDigitTemplate } from '@/lib/translate/rm-escape'

describe('normalizeTranslateKey', () => {
  it('removes stray quote fragments and applies NFKC', () => {
    expect(normalizeTranslateKey('"こんにちは");')).toBe('こんにちは')
    expect(normalizeTranslateKey('ｶﾀｶﾅ')).toBe('カタカナ')
  })
})

describe('trailingNumberParts', () => {
  it('splits a stem and trailing number', () => {
    expect(trailingNumberParts('自警団の団員2')).toEqual({ stem: '自警団の団員', num: '2' })
    expect(trailingNumberParts('ただです')).toBeNull()
  })
})

describe('safe sentence aliases (no whitespace erasure or inferred alignment)', () => {
  it('does not infer translations across orphan title quotes', () => {
    expect(lookupTranslationRecord({ '品評会」開催当日': '品评会」举办当日' }, '開催当日')).toBeNull()
    expect(lookupTranslationRecord({ '品評会」開催当日': '品评会举办当日' }, '開催当日')).toBeNull()
    expect(lookupTranslationRecord({ '品評会」開催当日': '品评会」举办当日', '記念日」開催当日': '纪念日」活动当天' }, '開催当日')).toBeNull()
  })
  it.each([1, 2, 3])('reuses matching numbered prefixes without removing the source key for event %i', (number) => {
    const source = `M06_サブイベ${number}`
    const target = `M06_支线事件${number}`
    const lookup = { [source]: target }
    expect(lookupTranslationRecord(lookup, `サブイベ${number}`)).toBe(`支线事件${number}`)
    expect(translateWithLookup(lookup, `サブイベ${number}`)).toBe(`支线事件${number}`)
    expect(translateWithLookup(lookup, source)).toBe(target)
    expect(lookup).toEqual({ [source]: target })
  })

  it.each([
    ['M06_サブイベ1', 'M07_支线事件1'],
    ['M06_サブイベ1', 'm06_支线事件1'],
    ['EVENT_サブイベ1', 'EVENT_支线事件1'],
    ['場所M06_サブイベ1', '位置M06_支线事件1'],
    ['M06_サブイベ1_name', 'M06_支线事件1_name'],
    ['M06_サブイベ1', 'M06_'],
    [String.raw`\N[1]M06_サブイベ1`, 'M06_支线事件1'],
  ])('rejects unsafe prefix aliases for %s and %s', (source, target) => {
    expect(lookupTranslationRecord({ [source]: target }, 'サブイベ1')).toBeNull()
  })

  it('rejects conflicting prefix aliases and prefers an explicit bare entry', () => {
    const lookup = { M06_サブイベ1: 'M06_支线事件1', M07_サブイベ1: 'M07_支线任务1' }
    expect(lookupTranslationRecord(lookup, 'サブイベ1')).toBeNull()
    expect(lookupTranslationRecord({ ...lookup, サブイベ1: '独立译文1' }, 'サブイベ1')).toBe('独立译文1')
  })

  it('does not promote structural punctuation alignment to verified translations', () => {
    const lookup = { '受付係の！マーク消去': '接待员！标记消除' }
    expect(translateWithLookup(lookup, '受付係の！')).toBe('受付係の！')
    expect(lookupTranslationRecord(lookup, 'マーク消去')).toBeNull()
    expect(lookupTranslationRecord({ '受付係の！マーク消去': '接待员？标记消除' }, '受付係の')).toBeNull()
    expect(lookupTranslationRecord({ '受付係の！マーク消去': '接待员标记消除' }, '受付係の')).toBeNull()
    expect(lookupTranslationRecord({ '受付係の！マーク消去': '接待员！标记！消除' }, '受付係の')).toBeNull()
    expect(lookupTranslationRecord({ '受付係の\\V[1]！マーク消去': '接待员！标记消除\\V[1]' }, '受付係の')).toBeNull()
  })

  it('prefers whole records and rejects ambiguous punctuation fragments', () => {
    const lookup = { '受付係の！マーク消去': '接待员！标记消除', '受付係の！案内開始': '前台！开始引导' }
    expect(lookupTranslationRecord(lookup, '受付係の')).toBeNull()
    expect(translateWithLookup({ ...lookup, '受付係の！': '专用译文！' }, '受付係の！')).toBe('专用译文！')
  })
  it('preserves exact paragraphs without inferring visual-line mappings', () => {
    const source = '「ほう、よくわかったな。\n　お前の想像通り、これは催眠魔法でな。\n　いつからだったか……、おいマキ、覚えてるか？」'
    const target = '「嚯，挺敏锐嘛。\n正如你所想，这是催眠魔法。\n从什么时候开始来着......喂真纪，还记得吗？」'
    const query = source.replace(/\u3000/g, '')
    const lookup = { [source]: target, [query]: '' }
    expect(lookupTranslationRecord(lookup, query)).toBeNull()
    expect(lookupTranslationRecord(lookup, 'いつからだったか……、おいマキ、覚えてるか')).toBeNull()
    expect(lookupTranslationRecord(lookup, 'お前の想像通り、これは催眠魔法でな')).toBeNull()
    expect(lookupTranslationRecord(lookup, 'おいマキ')).toBeNull()
    lookup[query] = '「完整原文优先的译文」'
    expect(lookupTranslationRecord(lookup, query)).toBe('「完整原文优先的译文」')
  })

  it('does not zip visual lines with unequal counts or misplaced variable tokens', () => {
    expect(lookupTranslationRecord({ '「こんにちは\n行こう」': '「你好，出发吧」' }, 'こんにちは')).toBeNull()
    expect(lookupTranslationRecord({ '「こんにちは\\V[1]\n行こう」': '「你好\n出发吧\\V[1]」' }, 'こんにちは')).toBeNull()
    expect(lookupTranslationRecord({ '「こんにちは\n行こう」': '「你好\n出发吧」', '「こんにちは\n戻ろう」': '「您好\n回去吧」' }, 'こんにちは')).toBeNull()
  })
  it('matches conditions in either direction and leaves empty seed values available for fallback', () => {
    expect(translateWithLookup({ 'en(!s[671])様子を観察する': '', 様子を観察する: '暗中观察' }, 'en(!s[671])様子を観察する')).toBe('en(!s[671])暗中观察')
    expect(translateWithLookup({ 'en(!s[671])様子を観察する': 'en(!s[671])暗中观察' }, '様子を観察する')).toBe('暗中观察')
    expect(translateWithLookup({ '様子を観察するif(s[1])': '暗中观察if(s[1])' }, 'en(!s[671])様子を観察する')).toBe('en(!s[671])暗中观察')
  })

  it('indexes wrapper-free and aligned paragraph fragments without guessing arbitrary substrings', () => {
    const lookup = { '「こんにちは，村へ行こう。」': '「你好，去村子吧。」' }
    expect(translateWithLookup(lookup, 'en(true)村へ行こう')).toBe('en(true)村へ行こう')
    expect(translateWithLookup(lookup, '「こんにちは！」')).toBe('「こんにちは！」')
    expect(translateWithLookup(lookup, '村へ行こうと思う')).toBe('村へ行こうと思う')
    expect(lookupTranslationRecord({ 'こんにちは，村へ行こう。': '你好去村子吧。' }, '村へ行こう')).toBeNull()
  })

  it('rejects conflicting inferred translations and prefers standalone translations over paragraph fragments', () => {
    const lookup = { 'en(s[1])様子を観察する': '暗中观察', 'en(s[2])様子を観察する': '观察情况' }
    expect(lookupTranslationRecord(lookup, '様子を観察する')).toBeNull()
    expect(lookupTranslationRecord({ ...lookup, 様子を観察する: '查看情况' }, '様子を観察する')).toBe('查看情况')
    expect(lookupTranslationRecord({ '「こんにちは」': '「您好」', 'こんにちは，行こう。': '你好，出发吧。' }, 'こんにちは')).toBe('您好')
  })

  it('does not infer aliases from broken control variables or translated condition code', () => {
    expect(lookupTranslationRecord({ 'こんにちは\\V[1]，行こう。': '你好，出发吧。' }, 'こんにちは')).toBeNull()
    expect(lookupTranslationRecord({ 'こんにちはif(s[1])': '你好如果(s[1])' }, 'こんにちは')).toBeNull()
  })

  it('preserves unknown whitespace and word boundaries', () => {
    const source = '（大体、なんで来店してんのよ！\n　買い物したいなら……）'
    const target = '（到底为什么来店里！\n　想买东西的话……）'
    expect(lookupTranslationRecord({ [source]: target }, source.replace(/\s/g, ''))).toBeNull()
    expect(lookupTranslationRecord({ [source.replace(/\s/g, '')]: target }, source)).toBeNull()
    expect(translateWithLookup({ 'Hello world': '你好世界' }, 'Hel lo\tworld')).toBe('Hel lo\tworld')
  })

  it('keeps exact matches and refuses ambiguous compact matches', () => {
    const lookup = { 'a bc': '第一种', 'ab c': '第二种' }
    expect(lookupTranslationRecord(lookup, 'a bc')).toBe('第一种')
    expect(lookupTranslationRecord(lookup, 'ab c')).toBe('第二种')
    expect(lookupTranslationRecord(lookup, 'abc')).toBeNull()
  })

  it('ignores literal newlines while retaining variable codes and their arguments', () => {
    expect(compactTranslateKey('前\\n　后\n面')).toBe('前后面')
    expect(compactTranslateKey('前\\N[1] 后')).toBe('前\\N[1]后')
    expect(compactTranslateKey('前\\V[1 2] 后')).not.toBe(compactTranslateKey('前\\V[12]后'))
    expect(compactTranslateKey('前\\name 后')).toBe('前\\name后')
  })

  it('rebuilds the fallback index after an in-place cache update', () => {
    const lookup = { 'Hello world': '你好世界' }
    expect(lookupTranslationRecord(lookup, 'Hello world!')).toBeNull()
    lookup['Hello world'] = '世界你好'
    invalidateWhitespaceLookup(lookup)
    expect(lookupTranslationRecord(lookup, 'Hello world')).toBe('世界你好')
  })
})

describe('translateWithLookup', () => {
  it.each(['\n', String.raw`\n`])('reuses legacy quoted line entries for complete dialogue with %j', (newline) => {
    const lookup = { '「セリカ様、': '「赛莉卡大人，', 'カウンター内は従業員以外立ち入り禁止ですよ」': '柜台后方禁止非工作人员进入哦」' }
    const source = `「セリカ様、${newline}カウンター内は従業員以外立ち入り禁止ですよ」`
    expect(lookupTranslationRecord(lookup, 'セリカ様')).toBeNull()
    expect(lookupTranslationRecord(lookup, 'カウンター内は従業員以外立ち入り禁止ですよ')).toBeNull()
    expect(translateWithLookup(lookup, source)).toBe(
      newline === String.raw`\n` ? `「セリカ様、${newline}柜台后方禁止非工作人员进入哦」` : `「赛莉卡大人、${newline}柜台后方禁止非工作人员进入哦」`
    )
  })
  it('returns an exact match', () => {
    const lookup = { こんにちは: '你好' }
    expect(translateWithLookup(lookup, 'こんにちは')).toBe('你好')
  })

  it('matches segments around RM controls', () => {
    const lookup = { 回復: '恢复' }
    expect(translateWithLookup(lookup, '\\C[2]回復\\C[0]する')).toBe('\\C[2]恢复\\C[0]する')
  })

  it('reuses a numbered control template across actor IDs', () => {
    const lookup = {
      [toRmDigitTemplate('ボクと\\n[1]だけの秘密')]: toRmDigitTemplate('所以和\\n[1]的秘密'),
    }
    expect(translateWithLookup(lookup, 'ボクと\\n[3]だけの秘密')).toBe('所以和\\n[3]的秘密')
  })

  it('infers trailing-number variants', () => {
    const lookup = { 自警団の団員2: '自警团团员2' }
    const stemBase = new Map<string, string>()
    indexTrailingStem(stemBase, '自警団の団員2', '自警团团员2')
    expect(translateWithLookup(lookup, '自警団の団員5', { stemBase })).toBe('自警团团员5')
  })
})

describe('glossary template', () => {
  const entries: GlossaryEntry[] = [
    { jp: 'アリス', type: 'name', token: '__NAME__' },
    { jp: 'ボブ', type: 'name', token: '__NAME__' },
  ]

  it('reuses sentence templates with different proper names', () => {
    const templateZh = new Map<string, string>()
    const zhMap = { アリス: '爱丽丝', ボブ: '鲍勃' }
    indexGlossaryTemplate(templateZh, 'アリスはボブを殴った', '爱丽丝打了鲍勃', entries, zhMap)
    expect(maskGlossary('キャロルはボブを殴った', [...entries, { jp: 'キャロル', type: 'name', token: '__NAME__' }]).masked).toBe('__NAME__は__NAME__を殴った')
    const more: GlossaryEntry[] = [...entries, { jp: 'キャロル', type: 'name', token: '__NAME__' }]
    const zh = translateByGlossaryTemplate('キャロルはボブを殴った', more, { ...zhMap, キャロル: '卡罗尔' }, templateZh)
    expect(zh).toBe('卡罗尔打了鲍勃')
  })
})
