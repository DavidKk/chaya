import { createLookupEnrichment } from '@/plugins/src/translator/lookup/lookup-enrich'

describe('notification templates through the runtime lookup', () => {
  const game = globalThis as unknown as Record<string, unknown>
  afterEach(() => {
    for (const key of ['$dataActors', '$dataItems', '$gameActors']) delete game[key]
  })

  it('matches before partial glossary hits and handles names patched or renamed after indexing', () => {
    game.$dataActors = [null, { name: 'アリス' }]
    game.$dataItems = [null, { name: 'ポーション', description: '体力を回復する' }]
    const src = String.raw`_actorは「\I[_icon]_name」 を\C[14]_num個\C[24]手に入れた！\n\C[6]_desc1`
    const lookup = {
      [src]: String.raw`_actor获得了「\I[_icon]_name」\C[14]_num个\C[24]！\n\C[6]_desc1`,
      アリス: '爱丽丝',
      ポーション: '药水',
      体力を回復する: '恢复体力',
    }
    const enrich = createLookupEnrichment()
    enrich.reindexAll(lookup)
    expect(enrich.resolve(lookup, String.raw`\FS[20]アリスは「\I[12]ポーション」 を\C[14]3個\C[24]手に入れた！`)).toBe(
      String.raw`\FS[20]爱丽丝获得了「\I[12]药水」\C[14]3个\C[24]！`
    )
    game.$dataItems = [null, { name: '药水', description: '恢复体力' }]
    game.$gameActors = { _data: [null, { name: () => '自定义角色' }] }
    expect(enrich.resolve(lookup, String.raw`自定义角色は「\I[12]药水」 を\C[14]5個\C[24]手に入れた！`)).toBe(String.raw`自定义角色获得了「\I[12]药水」\C[14]5个\C[24]！`)
    expect(enrich.resolve(lookup, String.raw`\FS[20]\C[6]恢复体力`)).toBe(String.raw`\FS[20]\C[6]恢复体力`)
    expect(enrich.resolve(lookup, '完全に別の文章')).toBeNull()
  })

  it('adds new templates through incremental cache writes', () => {
    const enrich = createLookupEnrichment()
    const lookup = { '_num個を得た！': '获得_num个！' }
    enrich.notePair('_num個を得た！', '获得_num个！', lookup)
    expect(enrich.resolve(lookup, '12個を得た！')).toBe('获得12个！')
    enrich.reindexAll({})
    expect(enrich.resolve({}, '12個を得た！')).toBeNull()
  })
})
