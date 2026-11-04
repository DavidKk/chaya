import { evalNumericCondition, matchRowQuery, normalizeSearchSymbols, parseNumericCondition } from '@/lib/game/save-data'

describe('save-data & game-edit quantity/value search', () => {
  describe('normalizeSearchSymbols', () => {
    it('converts full-width colons, comparison operators, and symbols to half-width', () => {
      expect(normalizeSearchSymbols('数量：＞＝10')).toBe('数量:>=10')
      expect(normalizeSearchSymbols('数量：＞0')).toBe('数量:>0')
      expect(normalizeSearchSymbols('值：＜＝5')).toBe('值:<=5')
      expect(normalizeSearchSymbols('！＝0')).toBe('!=0')
      expect(normalizeSearchSymbols('＜＞0')).toBe('<>0')
      expect(normalizeSearchSymbols('＝100')).toBe('=100')
      expect(normalizeSearchSymbols('＊5')).toBe('*5')
    })
  })

  describe('parseNumericCondition', () => {
    it('parses comparison operators', () => {
      expect(parseNumericCondition('>0')).toEqual({ op: '>', target: 0 })
      expect(parseNumericCondition('>=10')).toEqual({ op: '>=', target: 10 })
      expect(parseNumericCondition('<5')).toEqual({ op: '<', target: 5 })
      expect(parseNumericCondition('<=0')).toEqual({ op: '<=', target: 0 })
      expect(parseNumericCondition('=5')).toEqual({ op: '==', target: 5 })
      expect(parseNumericCondition('==5')).toEqual({ op: '==', target: 5 })
      expect(parseNumericCondition('!=0')).toEqual({ op: '!=', target: 0 })
      expect(parseNumericCondition('<>0')).toEqual({ op: '!=', target: 0 })
    })

    it('parses operators with whitespace', () => {
      expect(parseNumericCondition('> 0')).toEqual({ op: '>', target: 0 })
      expect(parseNumericCondition('>= 10')).toEqual({ op: '>=', target: 10 })
      expect(parseNumericCondition('<= 5')).toEqual({ op: '<=', target: 5 })
    })

    it('parses prefixes with or without colons/equals', () => {
      expect(parseNumericCondition('qty:>5')).toEqual({ op: '>', target: 5 })
      expect(parseNumericCondition('qty:5')).toEqual({ op: '==', target: 5 })
      expect(parseNumericCondition('count:10')).toEqual({ op: '==', target: 10 })
      expect(parseNumericCondition('count:>0')).toEqual({ op: '>', target: 0 })
      expect(parseNumericCondition('val:0')).toEqual({ op: '==', target: 0 })
      expect(parseNumericCondition('val:>100')).toEqual({ op: '>', target: 100 })
      expect(parseNumericCondition('数量:>=10')).toEqual({ op: '>=', target: 10 })
      expect(parseNumericCondition('数量:>0')).toEqual({ op: '>', target: 0 })
      expect(parseNumericCondition('数量:5')).toEqual({ op: '==', target: 5 })
      expect(parseNumericCondition('数量=5')).toEqual({ op: '==', target: 5 })
      expect(parseNumericCondition('值:50')).toEqual({ op: '==', target: 50 })
      expect(parseNumericCondition('持有:>0')).toEqual({ op: '>', target: 0 })
      expect(parseNumericCondition('持有:5')).toEqual({ op: '==', target: 5 })
    })

    it('parses multiplier notation', () => {
      expect(parseNumericCondition('x5')).toEqual({ op: '==', target: 5 })
      expect(parseNumericCondition('*10')).toEqual({ op: '==', target: 10 })
      expect(parseNumericCondition('x 20')).toEqual({ op: '==', target: 20 })
      expect(parseNumericCondition('* 0')).toEqual({ op: '==', target: 0 })
    })

    it('returns null for non-condition strings', () => {
      expect(parseNumericCondition('')).toBeNull()
      expect(parseNumericCondition('草药')).toBeNull()
      expect(parseNumericCondition('potion')).toBeNull()
      expect(parseNumericCondition('>abc')).toBeNull()
    })
  })

  describe('evalNumericCondition', () => {
    it('evaluates comparisons accurately', () => {
      expect(evalNumericCondition(5, { op: '==', target: 5 })).toBe(true)
      expect(evalNumericCondition(4, { op: '==', target: 5 })).toBe(false)
      expect(evalNumericCondition(5, { op: '!=', target: 0 })).toBe(true)
      expect(evalNumericCondition(0, { op: '!=', target: 0 })).toBe(false)
      expect(evalNumericCondition(6, { op: '>', target: 5 })).toBe(true)
      expect(evalNumericCondition(5, { op: '>', target: 5 })).toBe(false)
      expect(evalNumericCondition(5, { op: '>=', target: 5 })).toBe(true)
      expect(evalNumericCondition(4, { op: '<', target: 5 })).toBe(true)
      expect(evalNumericCondition(5, { op: '<=', target: 5 })).toBe(true)
    })
  })

  describe('matchRowQuery', () => {
    const potionRow = { id: 1, name: '回复草药', description: '恢复 50 点 HP', value: 5 }
    const elixirRow = { id: 2, name: '万能仙药', description: '恢复全部状态', value: 0 }
    const goldVar = { id: 10, name: '金币总数', value: 2500 }
    const flagSwOn = { id: 100, name: '通关主线标志', value: true }
    const flagSwOff = { id: 101, name: '二周目开启标志', value: false }

    it('matches empty queries', () => {
      expect(matchRowQuery(potionRow, '')).toBe(true)
      expect(matchRowQuery(potionRow, '   ')).toBe(true)
    })

    it('matches plain text and IDs', () => {
      expect(matchRowQuery(potionRow, '回复')).toBe(true)
      expect(matchRowQuery(potionRow, '草药')).toBe(true)
      expect(matchRowQuery(potionRow, '1')).toBe(true)
      expect(matchRowQuery(potionRow, '万能')).toBe(false)
    })

    it('matches exact quantity via plain number', () => {
      expect(matchRowQuery(potionRow, '5')).toBe(true)
      expect(matchRowQuery(elixirRow, '0')).toBe(true)
      expect(matchRowQuery(elixirRow, '5')).toBe(false)
    })

    it('matches quantity conditions (>0, >=5, <10, =5, !=0)', () => {
      expect(matchRowQuery(potionRow, '>0')).toBe(true)
      expect(matchRowQuery(potionRow, '>=5')).toBe(true)
      expect(matchRowQuery(potionRow, '<10')).toBe(true)
      expect(matchRowQuery(potionRow, '=5')).toBe(true)
      expect(matchRowQuery(potionRow, '!=0')).toBe(true)
      expect(matchRowQuery(potionRow, '>5')).toBe(false)
      expect(matchRowQuery(potionRow, '<5')).toBe(false)
      expect(matchRowQuery(potionRow, '=0')).toBe(false)

      expect(matchRowQuery(elixirRow, '>0')).toBe(false)
      expect(matchRowQuery(elixirRow, '=0')).toBe(true)
      expect(matchRowQuery(elixirRow, '<=0')).toBe(true)
    })

    it('matches prefixes (qty:5, count:>0, 数量:>=5, x5)', () => {
      expect(matchRowQuery(potionRow, 'qty:5')).toBe(true)
      expect(matchRowQuery(potionRow, 'count:>0')).toBe(true)
      expect(matchRowQuery(potionRow, '数量:>=5')).toBe(true)
      expect(matchRowQuery(potionRow, '数量:>0')).toBe(true)
      expect(matchRowQuery(potionRow, '持有:>0')).toBe(true)
      expect(matchRowQuery(potionRow, 'x5')).toBe(true)
      expect(matchRowQuery(potionRow, '*5')).toBe(true)

      expect(matchRowQuery(elixirRow, '数量:>0')).toBe(false)
      expect(matchRowQuery(elixirRow, '数量:0')).toBe(true)
    })

    it('supports multi-token combined search (AND logic)', () => {
      expect(matchRowQuery(potionRow, '草药 >0')).toBe(true)
      expect(matchRowQuery(potionRow, '草药 5')).toBe(true)
      expect(matchRowQuery(potionRow, '草药 数量:5')).toBe(true)
      expect(matchRowQuery(potionRow, '草药 =0')).toBe(false)
      expect(matchRowQuery(potionRow, '仙药 >0')).toBe(false)

      // Split attached operators: "草药>0"
      expect(matchRowQuery(potionRow, '草药>0')).toBe(true)
      expect(matchRowQuery(potionRow, '草药=0')).toBe(false)
      expect(matchRowQuery(potionRow, '草药x5')).toBe(true)
    })

    it('supports full-width IME characters', () => {
      expect(matchRowQuery(potionRow, '数量：＞0')).toBe(true)
      expect(matchRowQuery(potionRow, '数量：＝5')).toBe(true)
      expect(matchRowQuery(potionRow, '！＝0')).toBe(true)
      expect(matchRowQuery(elixirRow, '数量：＞0')).toBe(false)
    })

    it('matches variable values', () => {
      expect(matchRowQuery(goldVar, '2500')).toBe(true)
      expect(matchRowQuery(goldVar, '>1000')).toBe(true)
      expect(matchRowQuery(goldVar, 'val:>2000')).toBe(true)
      expect(matchRowQuery(goldVar, '值:2500')).toBe(true)
      expect(matchRowQuery(goldVar, '金币 >2000')).toBe(true)
      expect(matchRowQuery(goldVar, '金币 <1000')).toBe(false)
    })

    it('matches switches with boolean tokens (on, off, true, false, 开, 关)', () => {
      expect(matchRowQuery(flagSwOn, 'on')).toBe(true)
      expect(matchRowQuery(flagSwOn, 'true')).toBe(true)
      expect(matchRowQuery(flagSwOn, '开')).toBe(true)
      expect(matchRowQuery(flagSwOn, '开启')).toBe(true)
      expect(matchRowQuery(flagSwOn, 'off')).toBe(false)
      expect(matchRowQuery(flagSwOn, '关')).toBe(false)
      expect(matchRowQuery(flagSwOn, '主线 开')).toBe(true)

      expect(matchRowQuery(flagSwOff, 'off')).toBe(true)
      expect(matchRowQuery(flagSwOff, 'false')).toBe(true)
      expect(matchRowQuery(flagSwOff, '关')).toBe(true)
      expect(matchRowQuery(flagSwOff, '关闭')).toBe(true)
      expect(matchRowQuery(flagSwOff, 'on')).toBe(false)
      expect(matchRowQuery(flagSwOff, '二周目 关')).toBe(true)
    })
  })
})
