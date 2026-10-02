import { mayAccessApi } from '@/services/access/api'
import { ACCESS_COOKIE, hasManagementAccess } from '@/services/access/management'
import { clearLaunchToken, issueLaunchToken } from '@/services/runtime/launch-token'

describe('local API authorization', () => {
  const previous = { ...process.env }
  beforeEach(() => {
    process.env.CHAYA_AUTH_TOKEN = 'review-test-management-token'
    process.env.CHAYA_SERVICE = 'local'
    delete process.env.VERCEL
  })
  afterEach(() => {
    process.env = { ...previous }
    clearLaunchToken()
  })

  const request = (route: string, init?: RequestInit) => new Request(`http://localhost:3927${route}`, init)

  it('rejects anonymous requests regardless of claimed Host and Origin', async () => {
    expect(await mayAccessApi(request('/api/shell', { method: 'DELETE', headers: { Host: 'localhost:3927', Origin: 'http://localhost:3927' } }))).toBe(false)
    expect(await mayAccessApi(request('/api/status'))).toBe(false)
  })

  it('accepts management bearer or same-origin cookie, rejecting cross-site cookie use', async () => {
    expect(await mayAccessApi(request('/api/shell', { method: 'DELETE', headers: { Authorization: 'Bearer review-test-management-token' } }))).toBe(true)
    const cookie = `${ACCESS_COOKIE}=review-test-management-token`
    expect(hasManagementAccess(request('/api/status', { headers: { Cookie: cookie } }))).toBe(true)
    expect(hasManagementAccess(request('/api/status', { headers: { Cookie: cookie, Host: '127.0.0.1:3927', Origin: 'http://127.0.0.1:3927' } }))).toBe(true)
    expect(hasManagementAccess(request('/api/shell', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } }))).toBe(false)
  })

  it('limits plugin credentials to their room and live translation', async () => {
    const session = issueLaunchToken({ gameRoot: '/games/A', libraryId: 'room-A' })
    const headers = { 'X-Chaya-Launch-Token': session.token, 'Content-Type': 'application/json' }
    expect(await mayAccessApi(request('/api/runtime/webrtc?roomId=room-A', { headers }))).toBe(true)
    expect(await mayAccessApi(request('/api/runtime/webrtc?roomId=room-B', { headers }))).toBe(false)
    expect(await mayAccessApi(request('/api/runtime/webrtc', { method: 'POST', headers, body: JSON.stringify({ roomId: 'room-A', action: 'reset' }) }))).toBe(false)
    expect(await mayAccessApi(request('/api/runtime/agent', { method: 'POST', headers, body: JSON.stringify({ roomId: 'room-A' }) }))).toBe(true)
    expect(await mayAccessApi(request('/api/runtime/agent', { method: 'POST', headers, body: JSON.stringify({ roomId: 'room-B' }) }))).toBe(false)
    expect(await mayAccessApi(request('/api/mcp', { method: 'POST', headers, body: '{}' }))).toBe(false)
    expect(await mayAccessApi(request('/api/shell', { method: 'DELETE', headers }))).toBe(false)
    expect(await mayAccessApi(request('/api/translate', { method: 'POST', headers, body: JSON.stringify({ texts: ['こんにちは'] }) }))).toBe(true)
    expect(await mayAccessApi(request('/api/translate', { method: 'POST', headers, body: JSON.stringify({ mode: 'realtime', texts: ['こんにちは'] }) }))).toBe(true)
    for (const mode of ['play-settings', 'benchmark']) {
      expect(await mayAccessApi(request('/api/translate', { method: 'POST', headers, body: JSON.stringify({ mode }) }))).toBe(false)
    }
    expect(await mayAccessApi(request('/api/translate', { method: 'POST', headers, body: JSON.stringify({ mode: 'job', action: 'start' }) }))).toBe(false)
    expect(await mayAccessApi(request('/api/logs', { method: 'DELETE', headers }))).toBe(false)
  })
})
