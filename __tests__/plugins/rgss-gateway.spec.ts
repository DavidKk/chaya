/** @jest-environment jsdom */
import { GAME_LINK_TOKEN_HEADER } from '@/lib/runtime/game-link-protocol'
import { RgssWebRtcGateway } from '@/plugins/rgss/src/webrtc-gateway'

class Peer {
  static all: Peer[] = []
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription = { toJSON: () => ({ type: 'answer', sdp: 'answer-sdp' }) }
  ondatachannel: ((event: { channel: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  setRemoteDescription = jest.fn(async () => {})
  setLocalDescription = jest.fn(async () => {})
  createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }))
  close = jest.fn()
  constructor() {
    Peer.all.push(this)
  }
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const room = () => ({ ok: true, json: async () => ({ room: { offer: { type: 'offer', sdp: 'offer-sdp' } } }) })

describe('RGSS signaling and reconnect', () => {
  let request: jest.Mock
  let gateway: RgssWebRtcGateway
  beforeEach(() => {
    jest.useFakeTimers()
    Peer.all = []
    Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: Peer })
    request = jest.fn().mockImplementation(async (_url, init) => (init?.method === 'POST' ? { ok: true } : room()))
    globalThis.fetch = request
    gateway = new RgssWebRtcGateway('room', 'https://edge.example', {}, { linkToken: 'link-secret', launchToken: 'launch-secret' })
  })
  afterEach(() => {
    gateway.stop()
    jest.useRealTimers()
  })
  it('authenticates both offer polling and answer publication', async () => {
    gateway.start()
    await settle()
    expect(Peer.all[0].setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(request).toHaveBeenCalledTimes(2)
    for (const [, init] of request.mock.calls) {
      expect(init.headers[GAME_LINK_TOKEN_HEADER]).toBe('link-secret')
      expect(init.headers['X-Chaya-Launch-Token']).toBe('launch-secret')
    }
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ action: 'answer', roomId: 'room', sdp: { type: 'answer', sdp: 'answer-sdp' } })
  })
  it('retries the same offer after a rejected answer POST', async () => {
    request.mockImplementation(async (_url, init) => (init?.method === 'POST' ? { ok: false } : room()))
    gateway.start()
    await settle()
    expect(Peer.all[0].close).toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(6000)
    expect(Peer.all).toHaveLength(2)
  })
  it('ignores an offer fetch that completes after stop', async () => {
    let resolve!: (value: unknown) => void
    request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    gateway.start()
    gateway.stop()
    resolve(room())
    await settle()
    expect(Peer.all).toHaveLength(0)
    expect(jest.getTimerCount()).toBe(0)
  })
  it('reconnects after channel close even when the server retains the same offer', async () => {
    gateway.start()
    await settle()
    const channel = { readyState: 'open', send: jest.fn(), close: jest.fn(), onopen: null as null | (() => void), onclose: null as null | (() => void) }
    Peer.all[0].ondatachannel?.({ channel })
    channel.onopen?.()
    expect(JSON.parse(channel.send.mock.calls[0][0]).type).toBe('hello')
    channel.onclose?.()
    await jest.advanceTimersByTimeAsync(1000)
    expect(Peer.all).toHaveLength(2)
  })
})
