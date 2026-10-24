/**
 * @jest-environment jsdom
 */
import { createRgssServiceTranslationRequest, installRgssOverlayTranslationRuntime } from '@/plugins/rgss/src/translation-request'

describe('createRgssServiceTranslationRequest', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    delete (globalThis as { __chayaTranslationRuntime?: unknown }).__chayaTranslationRuntime
  })

  it('posts JSON to apiBase and injects contentRoot', async () => {
    const fetchMock = jest.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true, settings: { mode: 'pretranslated' } }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const request = createRgssServiceTranslationRequest({
      apiBase: 'http://127.0.0.1:3920',
      contentRoot: '/Games/Rei',
      launchToken: 'tok',
    })
    const result = await request({ path: '/api/translate', method: 'POST', body: { mode: 'play-settings' } })

    expect(result.status).toBe(200)
    expect(result.data).toEqual({ ok: true, settings: { mode: 'pretranslated' } })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3920/api/translate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Chaya-Launch-Token': 'tok' },
        body: JSON.stringify({ mode: 'play-settings', contentRoot: '/Games/Rei' }),
      })
    )
  })

  it('does not overwrite an explicit contentRoot', async () => {
    const fetchMock = jest.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const request = createRgssServiceTranslationRequest({ apiBase: 'http://127.0.0.1:3920', contentRoot: '/Games/A' })
    await request({ path: '/api/translate', method: 'POST', body: { mode: 'progress', contentRoot: '/Games/B' } })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ mode: 'progress', contentRoot: '/Games/B' })
  })

  it('injects contentRoot on body-less POST (extract)', async () => {
    const fetchMock = jest.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const request = createRgssServiceTranslationRequest({ apiBase: 'http://127.0.0.1:3920', contentRoot: '/Games/Rei' })
    await request({ path: '/api/extract', method: 'POST' })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ contentRoot: '/Games/Rei' })
  })

  it('installs a host runtime that can be disposed', async () => {
    globalThis.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ ok: true }) })) as unknown as typeof fetch
    const dispose = installRgssOverlayTranslationRuntime({ apiBase: 'http://127.0.0.1:3920' })
    const host = globalThis as { __chayaTranslationRuntime?: { request: unknown } }
    expect(host.__chayaTranslationRuntime?.request).toEqual(expect.any(Function))
    dispose()
    expect(host.__chayaTranslationRuntime).toBeUndefined()
  })
})
