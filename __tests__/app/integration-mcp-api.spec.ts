const mode = { current: 'vercel' as 'local' | 'vercel' | 'app' }

jest.mock('@/lib/service-mode/mode', () => ({
  getServiceMode: () => mode.current,
  canUseDisk: (m?: string) => (m ?? mode.current) !== 'vercel',
}))
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/runtime/launch-token', () => ({ peekLaunchToken: () => ({ token: 'launch', libraryId: 'lib' }) }))
jest.mock('@/services/access/management', () => ({ hasManagementAccess: () => false }))

import { GET } from '@/app/api/integration/mcp/route'

const ctx = { params: Promise.resolve({}) }
const URL_ = 'http://localhost/api/integration/mcp'
const call = async () => (await GET(new Request(URL_), ctx)).json()

beforeEach(() => {
  process.env.CHAYA_AUTH_TOKEN = 'secret-token'
  process.env.PORT = '3000'
  delete process.env.CHAYA_PUBLIC_ORIGIN
})

test('Edge exposes no connection info', async () => {
  mode.current = 'vercel'
  const body = await call()
  expect(body).toEqual({ ok: true, available: false, serviceMode: 'vercel' })
})

test('local mode returns its own /api/mcp endpoint, never secrets', async () => {
  mode.current = 'local'
  const body = await call()
  expect(body).toEqual({
    ok: true,
    available: true,
    serviceMode: 'local',
    endpoint: 'http://127.0.0.1:3000/api/mcp',
    evalEnabled: false,
  })
  expect(JSON.stringify(body)).not.toContain('secret-token')
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

  it('cannot read /api/integration/mcp', async () => {
    expect(await mayAccessApi(new Request('http://localhost/api/integration/mcp', { headers: launchHeaders }))).toBe(false)
  })
})
