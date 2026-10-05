import { createTranslationFetch, diskTranslationRequest } from '@/lib/translate/runtime-api'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

it('sends translation operations to the local disk API with the same response contract', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, done: 3 }) })
  globalThis.fetch = fetchMock
  const translationFetch = createTranslationFetch(diskTranslationRequest)
  const res = await translationFetch('/api/translate', { method: 'POST', body: JSON.stringify({ mode: 'progress' }) })
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/translate',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'progress' }), headers: { 'Content-Type': 'application/json' } })
  )
  expect(res.ok).toBe(true)
  expect(await res.json()).toEqual({ ok: true, done: 3 })
})

it('reports non-JSON failures as API errors', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue({ status: 501, json: async () => Promise.reject(new Error('html')) })
  const res = await diskTranslationRequest({ path: '/api/translate-cache?q=a', method: 'GET' })
  expect(res).toEqual({ status: 501, data: { ok: false, error: { message: '翻译请求失败（501）' } } })
})
