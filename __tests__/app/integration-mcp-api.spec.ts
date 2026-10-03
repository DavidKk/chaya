const mode = { current: 'vercel' as 'local' | 'vercel' | 'app' }

jest.mock('@/lib/service-mode/mode', () => ({
  getServiceMode: () => mode.current,
  canUseDisk: (m?: string) => (m ?? mode.current) !== 'vercel',
}))
jest.mock('@/services/runtime', () => ({ toolkitListenPort: () => 3927 }))
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/runtime/launch-token', () => ({ peekLaunchToken: () => ({ token: 'launch', libraryId: 'lib' }) }))
jest.mock('@/services/access/management', () => ({ hasManagementAccess: () => false }))

import { GET } from '@/app/api/integration/mcp/route'

const call = async () => (await GET(new Request('http://localhost/api/integration/mcp'), { params: Promise.resolve({}) })).json()

beforeEach(() => {
  process.env.CHAYA_AUTH_TOKEN = 'secret-token'
})

test('Edge never exposes the token', async () => {
  mode.current = 'vercel'
  const body = await call()
  expect(body).toEqual({ ok: true, available: false, serviceMode: 'vercel' })
})

test('local mode returns the loopback endpoint and token', async () => {
  mode.current = 'local'
  const body = await call()
  expect(body).toMatchObject({ available: true, endpoint: 'http://127.0.0.1:3927/api/mcp', token: 'secret-token', evalEnabled: false })
})

describe('a game launch token alone (no management access)', () => {
  const { mayAccessApi } = jest.requireActual<typeof import('@/services/access/api')>('@/services/access/api')
  const launchHeaders = { 'x-chaya-launch-token': 'launch', 'Content-Type': 'application/json' }

  beforeEach(() => {
    mode.current = 'local'
  })

  it('cannot reach /api/mcp', async () => {
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: launchHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(await mayAccessApi(request)).toBe(false)
  })

  it('cannot read the MCP token from /api/integration/mcp', async () => {
    expect(await mayAccessApi(new Request('http://localhost/api/integration/mcp', { headers: launchHeaders }))).toBe(false)
  })
})
