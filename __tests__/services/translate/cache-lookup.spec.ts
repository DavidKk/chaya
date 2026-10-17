import { lookupCachedTranslation, lookupGameTranslation, translationLookupKeys } from '@/services/translate/cache-lookup'

it('restores surrounding controls while looking up the stored core', () => {
  const values: Record<string, string> = { こんにちは: '你好' }
  expect(lookupCachedTranslation((key) => values[key], '\\C[0]こんにちは\\C[2]')).toBe('\\C[0]你好\\C[2]')
  expect(translationLookupKeys('\\C[0]こんにちは')).toContain('こんにちは')
})

it('requires translated ruby base text and reading before reassembling the complete dialogue', () => {
  const source = String.raw`「これは\RB[認定,オーソライズ]です」`
  const values: Record<string, string> = { '「これは': '「这是', 認定: '认证', オーソライズ: '授权', 'です」': '哦」' }
  expect(translationLookupKeys(source)).toEqual(expect.arrayContaining(['認定', 'オーソライズ', '「これは', 'です」']))
  expect(lookupCachedTranslation((key) => values[key], source)).toBe(String.raw`「这是\RB[认证,授权]哦」`)
  delete values['オーソライズ']
  expect(lookupCachedTranslation((key) => values[key], source)).toBe(String.raw`「这是\RB[認定,オーソライズ]哦」`)
  expect(lookupCachedTranslation((key) => ({ こんにちは: '你好' })[key as 'こんにちは'], String.raw`\RB[認定,オーソライズ]。こんにちは`)).toBe(
    String.raw`\RB[認定,オーソライズ]。你好`
  )
  values['オーソライズ'] = '授权,特殊'
  expect(lookupCachedTranslation((key) => values[key], source)).toBeNull()
})

it('joins prose around plugin ruby, color resets and gold icons when an argument is still untranslated', () => {
  const ruby = String.raw`その\ruby[穢れを知らない土手](新品おまんこ)を差し出す。`
  const values: Record<string, string> = { その: '把', 'を差し出す。': '递出来。', 新品おまんこ: '崭新小穴', '手に入れた！': '入手了！', 'を襲う。': '袭来。' }
  expect(lookupCachedTranslation((key) => values[key], ruby)).toBe(String.raw`把\ruby[穢れを知らない土手](新品おまんこ)递出来。`)
  values['穢れを知らない土手'] = '未经人事的土堤'
  expect(lookupCachedTranslation((key) => values[key], ruby)).toBe(String.raw`把\ruby[未经人事的土堤](崭新小穴)递出来。`)
  expect(lookupCachedTranslation((key) => values[key], String.raw`3000\G 手に入れた！`)).toBe(String.raw`3000\G 入手了！`)
  expect(lookupCachedTranslation((key) => values[key], String.raw`\RC[0]を襲う。`)).toBe(String.raw`\RC[0]袭来。`)
  expect(lookupCachedTranslation((key) => values[key], '<SG説明:を差し出す。')).toBe('<SG説明:递出来。')
})

it('joins cached prose around display controls and an untranslated ruby', () => {
  const source = String.raw`（でも、勝手に身体が火照ってきてる……\C[27]♥\C[0]\n\RB[下腹部,おなか]、段々と疼いてきてる……っ\C[27]♥）`
  const values: Record<string, string> = {
    '（でも、勝手に身体が火照ってきてる……': '（可是身体擅自发烫起来了......',
    '、段々と疼いてきてる……っ': '、越来越酥痒难耐了......啊',
  }
  expect(lookupCachedTranslation((key) => values[key], source)).toBe(String.raw`（可是身体擅自发烫起来了......\C[27]♥\C[0]\n\RB[下腹部,おなか]、越来越酥痒难耐了......啊\C[27]♥）`)
  values['下腹部'] = '下腹'
  values['おなか'] = '肚子'
  expect(lookupCachedTranslation((key) => values[key], source)).toBe(String.raw`（可是身体擅自发烫起来了......\C[27]♥\C[0]\n\RB[下腹,肚子]、越来越酥痒难耐了......啊\C[27]♥）`)
})

it('assembles all display-separated fragments, including multiline text, without losing controls', () => {
  const source =
    '「規律と秩序ある\\C[9]聖騎士団\\C[0]に、何でもお気軽にご相談くださいね。\n怠惰な\\C[20]王国軍\\C[0]、粗暴な\\C[10]冒険者ギルド\\C[0]なんかよりも\n私達は遥かに優秀ですから」'
  const values: Record<string, string> = {
    '「規律と秩序ある': '「秉持纪律与秩序的',
    聖騎士団: '圣骑士团',
    'に、何でもお気軽にご相談くださいね。': '请、请尽管来找我们商量哦。',
    怠惰な: '怠惰的',
    王国軍: '王国军',
    粗暴な: '粗野的',
    冒険者ギルド: '冒险者公会',
    なんかよりも: '比起那些',
    '私達は遥かに優秀ですから」': '我们可要优秀得多啦」',
  }
  const get = (key: string) => values[key]
  expect(translationLookupKeys(source)).toEqual(expect.arrayContaining(['聖騎士団', '王国軍', '冒険者ギルド', '怠惰な', 'なんかよりも']))
  const translated = lookupCachedTranslation(get, source)
  expect(translated).toBe(
    '「秉持纪律与秩序的\\C[9]圣骑士团\\C[0]请、请尽管来找我们商量哦。\n怠惰的\\C[20]王国军\\C[0]、粗野的\\C[10]冒险者公会\\C[0]比起那些\n我们可要优秀得多啦」'
  )
  values[source] = '整段专用译文'
  expect(lookupCachedTranslation(get, source)).toBe('整段专用译文')
  delete values[source]
  delete values['王国軍']
  expect(lookupCachedTranslation(get, source)).toBeNull()
})

it.each(['\n', '\r\n', String.raw`\n`])('assembles cached line bodies across %j without changing extraction boundaries', (newline) => {
  const source = `「セリカ様、${newline}　カウンター内は従業員以外立ち入り禁止ですよ」`
  const values: Record<string, string> = { セリカ様: '赛莉卡大人', カウンター内は従業員以外立ち入り禁止ですよ: '柜台后方禁止非工作人员进入哦' }
  expect(translationLookupKeys(source)).toEqual(expect.arrayContaining(Object.keys(values)))
  expect(lookupCachedTranslation((key) => values[key], source)).toBe(`「赛莉卡大人、${newline}　柜台后方禁止非工作人员进入哦」`)
  values[source] = '「整段优先译文」'
  expect(lookupCachedTranslation((key) => values[key], source)).toBe('「整段优先译文」')
  delete values[source]
  delete values['カウンター内は従業員以外立ち入り禁止ですよ']
  expect(lookupCachedTranslation((key) => values[key], source)).toBeNull()
})

it('rejects unchanged local seed values and restores numbered template codes', () => {
  expect(lookupCachedTranslation((key) => key, 'こんにちは')).toBeNull()
  const values: Record<string, string> = { '勇者\\n[#]です': '勇者\\n[#]' }
  expect(lookupCachedTranslation((key) => values[key], '勇者\\N[3]です')).toBe('勇者\\N[3]')
})

it('ignores poisoned whole-choice cache entries and preserves executable metadata', () => {
  const src = '\\C[2]こんにちはif(s[1])en(true)'
  const values: Record<string, string> = { [src]: '你好如果(s[1])启用(true)', こんにちは: '你好' }
  expect(lookupCachedTranslation((key) => values[key], src)).toBe('\\C[2]你好if(s[1])en(true)')
  expect(translationLookupKeys(src)).not.toContain(src)
})

it('prefers this game library and falls back to shared translations only on a miss', () => {
  const local: Record<string, string> = { こんにちは: '本作你好' }
  const shared: Record<string, string> = { こんにちは: '其他游戏的你好', さようなら: '再见' }
  const fromLocal = (key: string) => local[key]
  const fromShared = (key: string) => shared[key]
  expect(lookupGameTranslation(fromLocal, fromShared, 'こんにちは')).toEqual({ zh: '本作你好', engine: 'cache:local' })
  expect(lookupGameTranslation(fromLocal, fromShared, 'さようなら')).toEqual({ zh: '再见', engine: 'cache:remote' })
})
