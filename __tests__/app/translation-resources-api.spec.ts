jest.mock('@/services/access/api', () => ({ mayAccessApi: jest.fn(async () => true) }))
jest.mock('@/services/disk-ops', () => ({ requireDisk: jest.fn(() => null) }))
jest.mock('@/services/storage/client', () => ({ storageCall: jest.fn() }))

import { DatabaseSync } from 'node:sqlite'

import { GET, POST } from '@/app/api/translation-resources/route.server'
import { apiError } from '@/initializer/response'
import { mayAccessApi } from '@/services/access/api'
import { requireDisk } from '@/services/disk-ops'
import { storageCall } from '@/services/storage/client'
import { createTranslationResourceStore } from '@/services/storage/translation-resource-store'
import { RESOURCE_LIMITS } from '@/services/translate/resources/validate'

const url = 'http://localhost/api/translation-resources'
const context = { params: Promise.resolve({}) }
const post = (body: unknown) => POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }), context)
const get = (query = '') => GET(new Request(url + query), context)
const content = (version = '1', targetText = '测试一') =>
  [
    { type: 'manifest', schemaVersion: 1, packId: 'dev.test', version, languages: [] },
    {
      type: 'entry',
      entryId: 'sample',
      sourceLanguage: 'ja',
      targetLanguage: 'zh',
      sourceText: 'dev試験',
      targetText,
      scope: { kind: 'global' },
      reviewStatus: 'reviewed',
      provenance: { kind: 'test' },
      match: { kind: 'exact' },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n') + '\n'

let db: DatabaseSync
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(mayAccessApi).mockResolvedValue(true)
  jest.mocked(requireDisk).mockReturnValue(null)
  db = new DatabaseSync(':memory:')
  const store = createTranslationResourceStore(db)
  jest.mocked(storageCall).mockImplementation((method, args = []) => {
    const operation = method.split('.')[1] as keyof typeof store
    return Reflect.apply(store[operation], store, args)
  })
})
afterEach(() => db.close())

test('previews without mutation, applies a token and exports canonical JSONL', async () => {
  const preview = await (await post({ action: 'preview', content: content() })).json()
  expect(preview).toMatchObject({ ok: true, preview: { packId: 'dev.test', conflicts: [] } })
  expect((await (await get()).json()).packages).toHaveLength(1)
  expect((await post({ action: 'apply', content: content(), token: preview.preview.token })).status).toBe(200)
  expect((await (await get()).json()).packages).toEqual(expect.arrayContaining([expect.objectContaining({ packId: 'dev.test', version: '1', active: 1 })]))
  const exported = await get('?action=export&packId=dev.test&version=1')
  expect(exported.headers.get('content-type')).toContain('application/x-ndjson')
  expect(exported.headers.get('cache-control')).toBe('no-store')
  expect(await exported.text()).toBe(content())
})

test('imports, rolls back, disables and explicitly reactivates without overwriting immutable versions', async () => {
  const lookup = () => post({ action: 'lookup', sourceLanguage: 'ja', targetLanguage: 'zh', text: 'dev試験' })
  await post({ action: 'import', content: content() })
  await post({ action: 'import', content: content('2', '测试二') })
  expect(await (await lookup()).json()).toMatchObject({ hit: { targetText: '测试二', version: '2' } })
  await post({ action: 'rollback', packId: 'dev.test', version: '1' })
  await post({ action: 'import', content: content('2', '测试二') })
  expect(await (await lookup()).json()).toMatchObject({ hit: { targetText: '测试一', version: '1' } })
  expect((await post({ action: 'import', content: content('1', '篡改') })).status).toBe(400)
  await post({ action: 'disable', packId: 'dev.test' })
  expect(await (await lookup()).json()).toMatchObject({ hit: null })
  await post({ action: 'activate', packId: 'dev.test', version: '2' })
  expect(await (await lookup()).json()).toMatchObject({ hit: { targetText: '测试二' } })
})

test('rejects a stale preview without switching active data', async () => {
  const preview = await (await post({ action: 'preview', content: content() })).json()
  await post({ action: 'import', content: content('2', '测试二') })
  const response = await post({ action: 'apply', content: content(), token: preview.preview.token })
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'RESOURCE_REJECTED', message: expect.stringContaining('stale') } })
  expect((await (await get()).json()).packages).not.toEqual(expect.arrayContaining([expect.objectContaining({ packId: 'dev.test', version: '1' })]))
})

test.each([null, [], { action: 'unknown' }, { action: 'apply', content: content() }, { action: 'activate', packId: 'dev.test' }, { action: 'lookup', sourceLanguage: '???' }])(
  'rejects malformed requests without a storage mutation: %j',
  async (body) => {
    expect((await post(body)).status).toBe(400)
    expect(storageCall).not.toHaveBeenCalled()
  }
)

test('bounds UTF-8 content and streamed bodies without trusting Content-Length', async () => {
  expect((await post({ action: 'import', content: '啊'.repeat(Math.ceil(RESOURCE_LIMITS.bytes / 3)) })).status).toBe(400)
  const response = await POST(new Request(url, { method: 'POST', body: 'x'.repeat(RESOURCE_LIMITS.bytes * 6 + 4097) }), context)
  expect(response.status).toBe(400)
  expect(storageCall).not.toHaveBeenCalled()
})

test('denies management access and diskless operation before touching storage', async () => {
  jest.mocked(mayAccessApi).mockResolvedValue(false)
  expect((await get()).status).toBe(401)
  expect((await post({ action: 'import', content: content() })).status).toBe(401)
  jest.mocked(mayAccessApi).mockResolvedValue(true)
  jest.mocked(requireDisk).mockReturnValue(apiError(403, 'NO_DISK', 'Unavailable'))
  expect((await get()).status).toBe(403)
  expect((await post({ action: 'import', content: content() })).status).toBe(403)
  expect(storageCall).not.toHaveBeenCalled()
})
