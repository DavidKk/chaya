import { exportSourcesPayload, normalizeSourcesInput } from '@/services/translate/import-sources'

describe('normalizeSourcesInput', () => {
  it('accepts string arrays', () => {
    const r = normalizeSourcesInput(JSON.stringify(['こんにちは', 'こんにちは', '  ', 'さようなら']))
    expect(r.format).toBe('array')
    expect(r.entries.map((e) => e.src)).toEqual(['こんにちは', 'さようなら'])
    expect(r.entries[0].key).toBe('src_001')
  })

  it('accepts AST items and prefers id as business key', () => {
    const r = normalizeSourcesInput(
      JSON.stringify([
        { id: 'main_001', key: 'message', text: '私は白雨。', line: 22 },
        { id: 'main_002', key: 'label', text: 'はじめる', line: 40 },
      ])
    )
    expect(r.format).toBe('ast')
    expect(r.entries).toEqual([
      expect.objectContaining({ key: 'main_001', src: '私は白雨。', field: 'message', line: 22, state: 'pending' }),
      expect.objectContaining({ key: 'main_002', src: 'はじめる', field: 'label', line: 40 }),
    ])
  })

  it('accepts objects with optional prefilled translations', () => {
    const r = normalizeSourcesInput(JSON.stringify({ こんにちは: '你好', さようなら: '' }))
    expect(r.format).toBe('object')
    expect(r.entries).toEqual([
      expect.objectContaining({ key: 'こんにちは', src: 'こんにちは', zh: '你好', state: 'done' }),
      expect.objectContaining({ key: 'さようなら', src: 'さようなら', zh: '', state: 'pending' }),
    ])
  })

  it('rejects empty or invalid JSON', () => {
    expect(() => normalizeSourcesInput('')).toThrow('empty')
    expect(() => normalizeSourcesInput('not-json')).toThrow('valid JSON')
    expect(() => normalizeSourcesInput('[]')).toThrow('empty')
  })
})

describe('exportSourcesPayload', () => {
  const entries = [
    { key: 'main_001', src: '私は白雨。', zh: '我是白雨。', state: 'done' as const, field: 'message', line: 22 },
    { key: 'main_002', src: 'はじめる', zh: '', state: 'pending' as const, field: 'label', line: 40 },
  ]

  it('exports AST shape', () => {
    expect(exportSourcesPayload('ast', entries)).toEqual([
      { id: 'main_001', key: 'message', text: '私は白雨。', zh: '我是白雨。', state: 'done', line: 22 },
      { id: 'main_002', key: 'label', text: 'はじめる', zh: '', state: 'pending', line: 40 },
    ])
  })

  it('exports object map and onlyDone filter', () => {
    expect(exportSourcesPayload('object', entries)).toEqual({ '私は白雨。': '我是白雨。', はじめる: '' })
    expect(exportSourcesPayload('object', entries, { onlyDone: true })).toEqual({ '私は白雨。': '我是白雨。' })
  })
})
