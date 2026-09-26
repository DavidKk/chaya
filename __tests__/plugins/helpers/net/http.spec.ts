/**
 * @jest-environment jsdom
 */
import { chayaFetch, chayaPostJson } from '@/plugins/src/helpers/net/http'

describe('helpers/http', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    ;(window as Window & { CHAYA_API_BASE?: string }).CHAYA_API_BASE = 'http://127.0.0.1:3927'
  })

  afterEach(() => {
    delete (window as Window & { CHAYA_API_BASE?: string }).CHAYA_API_BASE
    delete window.CHAYA_LAUNCH_TOKEN
  })

  it('joins relative paths to api base; leaves absolute URLs alone', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response)
    await chayaFetch('/api/status')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3927/api/status', undefined)

    await chayaFetch('api/x')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3927/api/x', undefined)

    await chayaFetch('https://example.com/z', { method: 'HEAD' })
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/z', { method: 'HEAD' })
  })

  it('chayaPostJson sends Content-Type and JSON body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response)
    await chayaPostJson('/api/translate', { texts: ['a'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3927/api/translate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: ['a'] }),
      })
    )
  })

  it('attaches a launch credential only to the configured API origin', async () => {
    window.CHAYA_LAUNCH_TOKEN = 'plugin-test-token'
    fetchMock.mockResolvedValue({ ok: true } as Response)
    await chayaFetch('/api/translate')
    const options = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(options.headers).get('X-Chaya-Launch-Token')).toBe('plugin-test-token')
    await chayaFetch('https://other.example/api/translate')
    expect(fetchMock.mock.calls[1][1]).toBeUndefined()
  })

  it('authenticates the explicit loopback fallback when the primary API uses a LAN address', async () => {
    window.CHAYA_API_BASE = 'http://192.168.1.10:3927'
    window.CHAYA_LAUNCH_TOKEN = 'plugin-test-token'
    fetchMock.mockResolvedValue({ ok: true } as Response)
    await chayaFetch('http://127.0.0.1:3927/api/runtime/webrtc?roomId=game-A')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Chaya-Launch-Token')).toBe('plugin-test-token')
    await chayaFetch('http://127.0.0.1:9999/api/runtime/heartbeat')
    expect(fetchMock.mock.calls[1][1]).toBeUndefined()
  })

  it('throws when fetch and require are both missing', async () => {
    delete (globalThis as { fetch?: unknown }).fetch
    const prev = (globalThis as { require?: unknown }).require
    delete (globalThis as { require?: unknown }).require
    // Must match production Chinese error text
    await expect(chayaFetch('/x')).rejects.toThrow(/无 fetch/)
    if (prev !== undefined) (globalThis as { require?: unknown }).require = prev
  })
})
