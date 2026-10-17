import { chayaFetch } from '@/plugins/src/helpers/net/http'
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
jest.mock('@/plugins/src/helpers/net/http', () => ({
  chayaFetch: jest.fn(async () => {
    throw new Error('offline')
  }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createTranslationStore } from '@/plugins/src/translator/runtime/store'
import { createPluginTranslator } from '@/plugins/src/translator/runtime/translator'

describe('plugin sentence cache', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-plugin-block-'))
    jest.mocked(chayaFetch).mockReset().mockRejectedValue(new Error('offline'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  it('retains explicit reverse mappings after restarting the store', async () => {
    let store = createTranslationStore(root, { fs, path }, () => {})
    await store.put([['a,b,c', '甲，乙，丙']], 'import', [{ src: 'a,b,c', groups: [{ sourceStart: 2, sourceEnd: 5, targetStart: 2, targetEnd: 5, evidence: 'verified' }] }])
    store = createTranslationStore(root, { fs, path }, () => {})
    await store.load()
    expect(store.lookup('b,c')).toBe('乙，丙')
    expect(store.lookup('b')).toBeNull()
  })
  it('only sends the missing short sentence to a direct engine', async () => {
    const store = createTranslationStore(root, { fs, path }, () => {})
    await store.put([['村へ行く,休む', '前往村庄，休息']], 'import')
    const http = jest.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: '准备吧，' } })))
    const translator = createPluginTranslator(store, http)
    const result = await translator.translate(['準備する,村へ行く,休む'], { engines: ['ollama'], remote: false })
    expect(result[0]).toMatchObject({ zh: '准备吧,前往村庄，休息', status: 'full' })
    const body = JSON.parse(String(http.mock.calls[0][1]?.body))
    expect(body.messages[1].content).toContain('準備する,')
    expect(body.messages[1].content).not.toContain('村へ行く')
    expect(store.rows.has('準備する,村へ行く,休む')).toBe(false)
  })
  it('validates shared-owned hits even when they already cover the query', async () => {
    const store = createTranslationStore(root, { fs, path }, () => {})
    const origin = { id: '42', revision: 1, database: '/server/shared.sqlite' }
    fs.mkdirSync(path.dirname(store.fileFor('cacheNdjson')), { recursive: true })
    fs.writeFileSync(store.fileFor('cacheNdjson'), JSON.stringify({ s: 'こんにちは', t: '旧共享译文', engine: 'import', origin }) + '\n')
    await store.load()
    expect(store.lookup('こんにちは')).toBe('旧共享译文')
    jest.mocked(chayaFetch).mockResolvedValue(new Response(JSON.stringify({ available: true, items: [], invalidOrigins: [origin] })))
    const translator = createPluginTranslator(store)
    const result = await translator.translate(['こんにちは'], { engines: [] })
    expect(result[0].zh).toBeNull()
    expect(store.lookup('こんにちは')).toBeNull()
    expect(JSON.parse(String(jest.mocked(chayaFetch).mock.calls[0][1]?.body)).origins).toEqual([origin])
  })
  it('does not let platform output overwrite a local manual equivalent', async () => {
    const store = createTranslationStore(root, { fs, path }, () => {})
    await store.put([['あん？', '人工译文']], 'manual')
    await store.put([['あん?', '平台译文']], 'live:google')
    expect(store.lookup('あん?')).toBe('人工译文')
  })
})
