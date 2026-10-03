import { GET, POST } from '@/app/api/runtime/webrtc/route'
import { clearSignalingBoard, MAX_ROOMS_PER_OWNER, MAX_SIGNALING_ROOMS } from '@/services/runtime/webrtc-signaling'

const mode = { disk: false }
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ canUseDisk: () => mode.disk }))

const ctx = { params: Promise.resolve({}) }
const OWNER = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const offer = { type: 'offer', sdp: 'v=0 offer' }
const answer = { type: 'answer', sdp: 'v=0 answer' }

function post(body: Record<string, unknown>, token?: string, ip?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['X-Chaya-Link-Token'] = token
  if (ip) headers['X-Real-IP'] = ip
  return POST(new Request('http://localhost/api/runtime/webrtc', { method: 'POST', headers, body: JSON.stringify(body) }), ctx)
}

function get(roomId: string | null, token?: string) {
  const qs = roomId == null ? '' : `?roomId=${encodeURIComponent(roomId)}`
  return GET(new Request(`http://localhost/api/runtime/webrtc${qs}`, { headers: token ? { 'X-Chaya-Link-Token': token } : {} }), ctx)
}

beforeEach(() => {
  mode.disk = false
  clearSignalingBoard()
})

describe('browser mode signaling', () => {
  it('requires a room id and a link token', async () => {
    expect((await get(null, OWNER)).status).toBe(400)
    expect((await post({ action: 'offer', sdp: offer }, OWNER)).status).toBe(400)
    expect((await get('room-A')).status).toBe(401)
    expect((await post({ action: 'offer', roomId: 'room-A', sdp: offer })).status).toBe(401)
  })

  it('binds the room to the first web token and rejects everyone else', async () => {
    expect((await post({ action: 'reset', roomId: 'room-A' }, OWNER)).status).toBe(200)
    expect((await post({ action: 'offer', roomId: 'room-A', sdp: offer }, OWNER)).status).toBe(200)

    expect((await get('room-A', OTHER)).status).toBe(403)
    expect((await post({ action: 'answer', roomId: 'room-A', sdp: answer }, OTHER)).status).toBe(403)
    expect((await post({ action: 'reset', roomId: 'room-A' }, OTHER)).status).toBe(403)
    expect((await post({ action: 'offer', roomId: 'room-A', sdp: offer }, OTHER)).status).toBe(403)

    expect((await post({ action: 'answer', roomId: 'room-A', sdp: answer }, OWNER)).status).toBe(200)
    const room = (await (await get('room-A', OWNER)).json()).room
    expect(room).toMatchObject({ offer, answer })
    expect(room).not.toHaveProperty('tokenHash')
  })

  it('keeps the binding across reset so nobody can claim the room in between', async () => {
    await post({ action: 'offer', roomId: 'room-A', sdp: offer }, OWNER)
    await post({ action: 'reset', roomId: 'room-A' }, OWNER)
    expect((await post({ action: 'offer', roomId: 'room-A', sdp: offer }, OTHER)).status).toBe(403)
  })

  it('reading or answering never creates a room', async () => {
    const read = await (await get('room-A', OTHER)).json()
    expect(read.room).toBeNull()
    expect((await post({ action: 'answer', roomId: 'room-A', sdp: answer }, OTHER)).status).toBe(404)
    expect((await post({ action: 'offer', roomId: 'room-A', sdp: offer }, OWNER)).status).toBe(200)
  })

  it('limits how many rooms one client address can create', async () => {
    for (let i = 0; i < MAX_ROOMS_PER_OWNER; i++) expect((await post({ action: 'reset', roomId: `ip-${i}` }, OWNER, '203.0.113.7')).status).toBe(200)
    expect((await post({ action: 'reset', roomId: 'ip-extra' }, OWNER, '203.0.113.7')).status).toBe(429)
    expect((await post({ action: 'reset', roomId: 'ip-other' }, OWNER, '203.0.113.8')).status).toBe(200)
    expect((await post({ action: 'offer', roomId: 'ip-0', sdp: offer }, OWNER, '203.0.113.7')).status).toBe(200)
  })

  it('caps the number of rooms', async () => {
    for (let i = 0; i < MAX_SIGNALING_ROOMS; i++) await post({ action: 'reset', roomId: `r-${i}` }, OWNER)
    expect((await post({ action: 'reset', roomId: 'one-too-many' }, OWNER)).status).toBe(503)
  })
})

describe('server mode signaling', () => {
  it('relies on the API access policy and still requires a room id', async () => {
    mode.disk = true
    expect((await post({ action: 'offer', roomId: 'room-A', sdp: offer })).status).toBe(200)
    expect((await post({ action: 'answer', roomId: 'room-A', sdp: answer })).status).toBe(200)
    expect((await (await get('room-A')).json()).room).toMatchObject({ offer, answer })
    expect((await get(null)).status).toBe(400)
  })
})
