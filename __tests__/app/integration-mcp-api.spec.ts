const mode = { current: 'vercel' as 'local' | 'vercel' | 'app' }

jest.mock('@/lib/service-mode/mode', () => ({
  getServiceMode: () => mode.current,
  canUseDisk: (m?: string) => (m ?? mode.current) !== 'vercel',
}))
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/runtime/launch-token', () => ({ peekLaunchToken: () => ({ token: 'launch', libraryId: 'lib' }) }))
jest.mock('@/services/access/management', () => ({ hasManagementAccess: () => false }))

const status = (port: number, fileExists: boolean) => ({
  state: 'listening',
  port,
  url: `http://127.0.0.1:${port}/mcp`,
  file: '/home/u/.config/chaya/mcp.json',
  dir: '/home/u/.config/chaya',
  fileExists,
  holder: { chaya: true, role: 'server' },
  lastRequestAt: 1,
})
const gateway = {
  refresh: jest.fn(async () => status(39271, false)),
  status: jest.fn(() => status(39271, false)),
  setPort: jest.fn(async (port: number) => {
    if (port === 80) throw new Error('端口需在 1024–65535 之间')
    return status(port, true)
  }),
  resetPort: jest.fn(async () => status(39271, false)),
}
jest.mock('@/services/integration/mcp-gateway', () => ({ localMcpGateway: () => gateway }))
const reveal = jest.fn(async (_path: string) => undefined)
jest.mock('@/services/game/finder', () => ({ revealInFinder: (p: string) => reveal(p) }))

import { DELETE, GET, POST, PUT } from '@/app/api/integration/mcp/route'

const ctx = { params: Promise.resolve({}) }
const URL_ = 'http://localhost/api/integration/mcp'
const call = async () => (await GET(new Request(URL_), ctx)).json()

beforeEach(() => {
  process.env.CHAYA_AUTH_TOKEN = 'secret-token'
  process.env.PORT = '3000'
  delete process.env.CHAYA_PUBLIC_ORIGIN
  jest.clearAllMocks()
})

test('Edge exposes no connection info', async () => {
  mode.current = 'vercel'
  const body = await call()
  expect(body).toEqual({ ok: true, available: false, serviceMode: 'vercel' })
  expect(gateway.refresh).not.toHaveBeenCalled()
})

test('local mode returns the gateway and compat endpoint, never secrets', async () => {
  mode.current = 'local'
  const body = await call()
  expect(body).toEqual({
    ok: true,
    available: true,
    serviceMode: 'local',
    endpoint: 'http://127.0.0.1:3000/api/mcp',
    evalEnabled: false,
    gateway: {
      state: 'listening',
      port: 39271,
      url: 'http://127.0.0.1:39271/mcp',
      file: '/home/u/.config/chaya/mcp.json',
      dir: '/home/u/.config/chaya',
      fileExists: false,
      holderRole: 'server',
    },
  })
  expect(JSON.stringify(body)).not.toContain('secret-token')
})

describe('port management (local only)', () => {
  const put = (port: unknown) => PUT(new Request(URL_, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port }) }), ctx)

  it('PUT saves a new port and returns the new address', async () => {
    mode.current = 'local'
    const res = await put(39300)
    expect(res.status).toBe(200)
    expect((await res.json()).gateway).toMatchObject({ port: 39300, url: 'http://127.0.0.1:39300/mcp', fileExists: true })
    expect(gateway.setPort).toHaveBeenCalledWith(39300)
  })

  it('PUT reports invalid / occupied ports as 400', async () => {
    mode.current = 'local'
    const res = await put(80)
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('1024')
  })

  it('DELETE resets to the default port', async () => {
    mode.current = 'local'
    const res = await DELETE(new Request(URL_, { method: 'DELETE' }), ctx)
    expect((await res.json()).gateway).toMatchObject({ port: 39271, fileExists: false })
    expect(gateway.resetPort).toHaveBeenCalled()
  })

  it('POST reveals the config file only when it exists', async () => {
    mode.current = 'local'
    expect((await POST(new Request(URL_, { method: 'POST' }), ctx)).status).toBe(400)
    expect(reveal).not.toHaveBeenCalled()
    gateway.status.mockReturnValueOnce(status(39300, true))
    expect((await POST(new Request(URL_, { method: 'POST' }), ctx)).status).toBe(200)
    expect(reveal).toHaveBeenCalledWith('/home/u/.config/chaya/mcp.json')
  })

  it('is unavailable on Edge', async () => {
    mode.current = 'vercel'
    expect((await put(39300)).status).toBe(404)
    expect((await DELETE(new Request(URL_, { method: 'DELETE' }), ctx)).status).toBe(404)
    expect((await POST(new Request(URL_, { method: 'POST' }), ctx)).status).toBe(404)
    expect(gateway.setPort).not.toHaveBeenCalled()
  })
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
