import { mayAccessApi } from '@/services/access/api'
import { hasManagementAccess } from '@/services/access/management'
import { beginTurn, getOrCreateSession, resetGameAgentStore } from '@/services/game-agent/session-store'
import { clearLaunchToken, issueLaunchToken } from '@/services/runtime/launch-token'

describe('API authorization', () => {
  const previous = { ...process.env }
  beforeEach(() => {
    process.env.CHAYA_AUTH_TOKEN = 'review-test-management-token'
    process.env.CHAYA_SERVICE = 'local'
    delete process.env.VERCEL
    delete process.env.CHAYA_PUBLIC_ORIGIN
  })
  afterEach(() => {
    process.env = { ...previous }
    clearLaunchToken()
    resetGameAgentStore()
  })

  const request = (route: string, init?: RequestInit) => new Request(`http://localhost:3927${route}`, init)

  it('local: same-origin and non-browser requests need no login', async () => {
    expect(await mayAccessApi(request('/api/status'))).toBe(true)
    expect(await mayAccessApi(request('/api/shell', { method: 'DELETE', headers: { Host: 'localhost:3927', Origin: 'http://localhost:3927' } }))).toBe(true)
    expect(hasManagementAccess(request('/api/status', { headers: { Host: '127.0.0.1:3927', Origin: 'http://127.0.0.1:3927' } }))).toBe(true)
    expect(hasManagementAccess(request('/api/status', { headers: { Host: '192.168.1.8:3927' } }))).toBe(true)
    expect(await mayAccessApi(request('/api/mcp', { method: 'POST', body: '{}' }))).toBe(true)
  })

  it('local: rejects cross-site browser requests and rebinding hosts', async () => {
    expect(hasManagementAccess(request('/api/shell', { method: 'POST', headers: { Origin: 'https://evil.example' } }))).toBe(false)
    expect(hasManagementAccess(request('/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).toBe(false)
    expect(await mayAccessApi(request('/api/status', { headers: { Host: 'evil.example:3927', Origin: 'http://evil.example:3927' } }))).toBe(false)
    process.env.CHAYA_PUBLIC_ORIGIN = 'https://chaya.lan'
    expect(hasManagementAccess(request('/api/status', { headers: { Host: 'chaya.lan' } }))).toBe(true)
  })

  it('accepts the management bearer from anywhere', async () => {
    const headers = { Authorization: 'Bearer review-test-management-token', Host: 'evil.example', Origin: 'https://evil.example' }
    expect(await mayAccessApi(request('/api/shell', { method: 'DELETE', headers }))).toBe(true)
  })

  it('Edge: pages and APIs are public (no login; `/api/mcp` is not in the Edge build)', async () => {
    process.env.VERCEL = '1'
    expect(await mayAccessApi(request('/api/status'))).toBe(true)
    expect(await mayAccessApi(request('/api/translate', { method: 'POST', body: '{}' }))).toBe(true)
  })

  it('limits plugin credentials to their room and live translation', async () => {
    const session = issueLaunchToken({ gameRoot: '/games/A', libraryId: 'room-A' })
    const headers = { 'X-Chaya-Launch-Token': session.token, 'Content-Type': 'application/json', Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }
    expect(await mayAccessApi(request('/api/runtime/webrtc?roomId=room-A', { headers }))).toBe(true)
    expect(await mayAccessApi(request('/api/runtime/webrtc?roomId=room-B', { headers }))).toBe(false)
    expect(await mayAccessApi(request('/api/runtime/webrtc', { method: 'POST', headers, body: JSON.stringify({ roomId: 'room-A', action: 'reset' }) }))).toBe(false)
    expect(await mayAccessApi(request('/api/runtime/agent', { method: 'POST', headers, body: JSON.stringify({ roomId: 'room-A' }) }))).toBe(true)
    expect(await mayAccessApi(request('/api/runtime/agent', { method: 'POST', headers, body: JSON.stringify({ roomId: 'room-B' }) }))).toBe(false)
    expect(await mayAccessApi(request('/api/game-agent/status?gameId=room-A', { headers }))).toBe(true)
    expect(await mayAccessApi(request('/api/game-agent/status?gameId=room-B', { headers }))).toBe(false)
    expect(await mayAccessApi(request('/api/game-agent/turn', { method: 'POST', headers, body: JSON.stringify({ gameId: 'room-A' }) }))).toBe(true)
    expect(await mayAccessApi(request('/api/game-agent/turn', { method: 'POST', headers, body: JSON.stringify({ gameId: 'room-B' }) }))).toBe(false)
    const turn = beginTurn(getOrCreateSession('room-A', 'profile', 'demo'))
    expect(await mayAccessApi(request('/api/integration/game-agent', { headers }))).toBe(true)
    expect(await mayAccessApi(request(`/api/game-agent/turn/${turn.id}`, { method: 'DELETE', headers }))).toBe(true)
    const other = issueLaunchToken({ gameRoot: '/games/B', libraryId: 'room-B' })
    expect(
      await mayAccessApi(
        request(`/api/game-agent/turn/${turn.id}`, {
          method: 'DELETE',
          headers: { ...headers, 'X-Chaya-Launch-Token': other.token },
        })
      )
    ).toBe(false)
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
