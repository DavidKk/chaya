import { GET, POST } from '@/app/api/runtime/webrtc/route'
import { clearSignalingBoard, MAX_ROOMS_PER_OWNER, MAX_SIGNALING_ROOMS, optimizeAnswerSdp, patchOfferSdpWithLanIp } from '@/services/runtime/webrtc-signaling'

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

describe('SDP LAN IP patch and codec optimization', () => {
  it('replaces mDNS .local candidate and 0.0.0.0 connection IP with client LAN IP in offer', () => {
    const sdpWithLocal = [
      'v=0',
      'c=IN IP4 0.0.0.0',
      'a=candidate:1 1 udp 2113929215 b2e46b08-356a-4b0d-bca5-b82d4dbfb261.local 54321 typ host',
      'a=candidate:2 1 udp 16777215 175.100.196.178 61234 typ srflx raddr 0.0.0.0 rport 0',
    ].join('\r\n')

    const patched = patchOfferSdpWithLanIp(sdpWithLocal, '192.168.31.55')
    expect(patched).toContain('c=IN IP4 192.168.31.55')
    expect(patched).toContain('a=candidate:1 1 udp 2113929215 192.168.31.55 54321 typ host')
    expect(patched).toContain('175.100.196.178')
  })

  it('optimizes answer SDP for LAN clients by prioritizing H264 and Mac LAN IP while filtering virtual/loopback candidates', () => {
    const rawAnswer = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
      'c=IN IP4 127.0.0.1',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 H264/90000',
      'a=candidate:1 1 udp 2113929215 127.0.0.1 50001 typ host',
      'a=candidate:2 1 udp 2113929215 172.28.162.2 50002 typ host',
      'a=candidate:3 1 udp 2113929215 192.168.31.89 50003 typ host',
      'a=candidate:4 1 udp 16777215 175.100.196.178 50004 typ srflx raddr 0.0.0.0 rport 0',
    ].join('\r\n')

    const optimized = optimizeAnswerSdp(rawAnswer, '192.168.31.55', '192.168.31.89')
    expect(optimized).toContain('m=video 9 UDP/TLS/RTP/SAVPF 97 96')
    expect(optimized).toContain('c=IN IP4 192.168.31.89')
    expect(optimized).toContain('a=candidate:3 1 udp 2130706431 192.168.31.89 50003 typ host')
    expect(optimized).not.toContain('127.0.0.1 50001 typ host')
    expect(optimized).not.toContain('172.28.162.2')
  })

  it('exposes detected clientIp on GET /api/runtime/webrtc', async () => {
    const res = await GET(
      new Request('http://localhost/api/runtime/webrtc?roomId=test-room', {
        headers: { 'X-Real-IP': '192.168.31.77', 'X-Chaya-Link-Token': OWNER },
      }),
      ctx
    )
    const data = await res.json()
    expect(data.clientIp).toBe('192.168.31.77')
  })
  it('supports spectator peers alongside primary controller offer and answer', async () => {
    // 1. Controller establishes room
    await post({ action: 'offer', roomId: 'game-room', sdp: offer }, OWNER)
    await post({ action: 'answer', roomId: 'game-room', sdp: answer }, OWNER)
    await post({ action: 'connected', roomId: 'game-room', connected: true }, OWNER)

    // 2. Spectator joins with peerId
    const specOffer = { type: 'offer', sdp: 'v=0 spectator offer' }
    const specPostRes = await post({ action: 'offer', roomId: 'game-room', peerId: 'spec-1', role: 'spectator', sdp: specOffer }, OWNER)
    expect(specPostRes.status).toBe(200)

    // 3. Game inspects room and sees spectator in list
    const roomRes = await get('game-room', OWNER)
    const roomData = await roomRes.json()
    expect(roomData.room.offer.sdp).toBe(offer.sdp)
    expect(roomData.room.answer.sdp).toBe(answer.sdp)
    expect(roomData.room.webConnected).toBe(true)
    expect(roomData.room.spectators).toHaveLength(1)
    expect(roomData.room.spectators[0].peerId).toBe('spec-1')
    expect(roomData.room.spectators[0].offer.sdp).toBe(specOffer.sdp)

    // 4. Game answers spectator
    const specAnswer = { type: 'answer', sdp: 'v=0 spectator answer' }
    await post({ action: 'answer', roomId: 'game-room', peerId: 'spec-1', sdp: specAnswer }, OWNER)

    // 5. Spectator retrieves its answer
    const specGetRes = await GET(
      new Request('http://localhost/api/runtime/webrtc?roomId=game-room&peerId=spec-1', {
        headers: { 'X-Chaya-Link-Token': OWNER },
      }),
      ctx
    )
    const specGetData = await specGetRes.json()
    expect(specGetData.room.answer.sdp).toBe(specAnswer.sdp)

    // 6. Reset spectator peer leaves controller untouched
    await post({ action: 'reset', roomId: 'game-room', peerId: 'spec-1' }, OWNER)
    const afterReset = await (await get('game-room', OWNER)).json()
    expect(afterReset.room.spectators).toHaveLength(0)
    expect(afterReset.room.offer.sdp).toBe(offer.sdp)
  })
})
