import { createDynamicTemplateIndex, validDynamicTranslation } from '@/lib/translate/dynamic-template'
import { translationSources } from '@/lib/translate/segments'
import { isStorableTranslation, isUsefulTranslation, protectForTranslate, restoreForTranslate } from '@/services/translate/text-classify'

const source = String.raw`_actorは「\I[_icon]_name」 を\C[14]_num個\C[24]手に入れた！\n\C[6]_desc1`
const target = String.raw`_actor获得了「\I[_icon]_name」\C[14]_num个\C[24]！\n\C[6]_desc1`
const values = {
  _actor: new Set(['アリス', 'ボブ']),
  _name: new Set(['ポーション', 'エリクサー']),
  _desc1: new Set(['', '体力を回復する']),
}
const translate = (value: string) => ({ アリス: '爱丽丝', ボブ: '鲍勃', ポーション: '药水', エリクサー: '灵药', 体力を回復する: '恢复体力' })[value] || value

describe('GetInformation dynamic templates', () => {
  it('keeps the complete template as one source and protects every variable/control', () => {
    expect(translationSources(source)).toEqual([source])
    const guard = protectForTranslate(source)
    expect(guard.core).toBe(source)
    expect(guard.lead).toBe('')
    expect(guard.plain).not.toMatch(/_actor|_name|_num|_desc1|\\C|\\I/)
    expect(restoreForTranslate(guard.plain, guard)).toBe(source)
    expect(translationSources('「こんにちは」、次へ。')).toEqual(['こんにちは', '次へ'])
    expect(translationSources('_numberは「普通の文章」')).toEqual(['_numberは', '普通の文章'])
  })

  it('rejects missing, duplicated or changed variables, controls and line layout on import', () => {
    expect(isStorableTranslation(source, target)).toBe(true)
    for (const broken of [
      target.replace('_num', ''),
      target.replace('_num', '_num_num'),
      target.replace('_name', '_actor'),
      target.replace('\\C[14]', '\\C[15]'),
      target.replace('\\n', ''),
    ]) {
      expect(isStorableTranslation(source, broken)).toBe(false)
    }
    const guard = protectForTranslate(source)
    const raw = guard.plain.replace('手に入れた', '获得了').replace('は', '').replace('を', '').replace('個', '个')
    expect(isUsefulTranslation(source, guard.plain, raw, restoreForTranslate(raw, guard))).toBe(true)
    expect(isUsefulTranslation(source, guard.plain, raw + '__C0__', restoreForTranslate(raw + '__C0__', guard))).toBe(false)
    expect(isUsefulTranslation(source, guard.plain, raw + '__C999__', restoreForTranslate(raw + '__C999__', guard))).toBe(false)
  })

  it('reuses one translation for different actor/item/quantity/icon values and translates descriptions', () => {
    const index = createDynamicTemplateIndex()
    index.notePair(source, target)
    expect(index.resolve(String.raw`アリスは「\I[12]ポーション」 を\C[14]3個\C[24]手に入れた！\n\C[6]体力を回復する`, values, translate)).toBe(
      String.raw`爱丽丝获得了「\I[12]药水」\C[14]3个\C[24]！\n\C[6]恢复体力`
    )
    expect(index.resolve(String.raw`\FS[20]ボブは「\I[88]エリクサー」 を\C[14]25個\C[24]手に入れた！`, values, translate)).toBe(
      String.raw`\FS[20]鲍勃获得了「\I[88]灵药」\C[14]25个\C[24]！`
    )
    expect(index.resolve(String.raw`\FS[20]\C[6]体力を回復する`, values, translate)).toBe(String.raw`\FS[20]\C[6]恢复体力`)
    expect(index.resolve(String.raw`\C[6]`, values, translate)).toBe(String.raw`\C[6]`)
    expect(index.resolve(String.raw`知らない人は「\I[12]ポーション」 を\C[14]3個\C[24]手に入れた！`, values, translate)).toBeNull()
  })

  it('permits word order changes but refuses ambiguous matches and inconsistent repeated values', () => {
    const index = createDynamicTemplateIndex()
    index.notePair('_actorは_numポイントを得た！', '获得_num点的角色：_actor！')
    expect(index.resolve('アリスは20ポイントを得た！', values, translate)).toBe('获得20点的角色：爱丽丝！')
    index.notePair('_nameは_numポイントを得た！', '_name增加_num点！')
    expect(index.resolve('アリスは20ポイントを得た！', { ...values, _name: values._actor }, translate)).toBeNull()
    index.clear()
    index.notePair('_actorは_actorと戦う！', '_actor与_actor战斗！')
    expect(index.resolve('アリスはボブと戦う！', values, translate)).toBeNull()
    expect(index.resolve('アリスはアリスと戦う！', values, translate)).toBe('爱丽丝与爱丽丝战斗！')
    expect(validDynamicTranslation(source, target)).toBe(true)
  })

  it('consumes optional sound metadata without losing it in exported translations', () => {
    const index = createDynamicTemplateIndex()
    const src = '_se[Item3,90]_actorは_num個を得た！'
    const zh = '_se[Item3,90]_actor获得_num个！'
    index.notePair(src, zh)
    expect(index.resolve('アリスは2個を得た！', values, translate)).toBe('爱丽丝获得2个！')
    const guard = protectForTranslate(src)
    expect(guard.tokens).toContain('_se[Item3,90]')
  })
})
