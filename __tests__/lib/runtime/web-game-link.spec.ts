/**
 * @jest-environment jsdom
 */
import { WebGameLink } from '@/lib/runtime/web-game-link'

type Room = { offer?: unknown; answer?: RTCSessionDescriptionInit | null; webConnected?: boolean; updatedAt?: number }

let room: Room | null
const actions: string[] = []
const posts: Array<{ action: string; connected?: boolean }> = []

class FakeChannel {
  readyState = 'connecting'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  send = jest.fn()
  close = jest.fn(() => {
    this.readyState = 'closed'
    this.onclose?.()
  })
  open() {
    this.readyState = 'open'
    this.onopen?.()
  }
}

class FakePeer {
  connectionState = 'new'
  iceGatheringState = 'complete'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  onconnectionstatechange: (() => void) | null = null
  channel = new FakeChannel()
  createDataChannel = jest.fn(() => this.channel)
  createOffer = jest.fn(async () => ({ type: 'offer' as const, sdp: 'o' }))
  setLocalDescription = jest.fn(async (d: RTCSessionDescriptionInit) => {
    this.localDescription = { ...d, toJSON: () => ({ type: d.type, sdp: d.sdp }) } as RTCSessionDescriptionInit
  })
  setRemoteDescription = jest.fn(async (d: RTCSessionDescriptionInit) => {
    this.remoteDescription = d
  })
  addEventListener = jest.fn()
  removeEventListener = jest.fn()
  close = jest.fn()
}

let peer: FakePeer

beforeEach(() => {
  jest.useFakeTimers()
  room = null
  actions.length = 0
  posts.length = 0
  peer = new FakePeer()
  Object.assign(globalThis, {
    RTCPeerConnection: jest.fn(() => peer),
    fetch: jest.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { action: string; connected?: boolean; sdp?: RTCSessionDescriptionInit }
        actions.push(body.action)
        posts.push(body)
        if (body.action === 'reset') room = { offer: null, answer: null, webConnected: false, updatedAt: Date.now() }
        if (body.action === 'offer') room = { ...(room ?? {}), offer: body.sdp, answer: null, webConnected: false, updatedAt: Date.now() }
        if (body.action === 'connected' && room) {
          room.webConnected = !!body.connected
          room.updatedAt = Date.now()
        }
        return { ok: true, json: async () => ({ ok: true }) }
      }
      if (url.includes('/api/runtime/webrtc?')) return { ok: true, json: async () => ({ ok: true, room }) }
      return { ok: false, json: async () => ({}) }
    }),
  })
})

afterEach(() => {
  jest.useRealTimers()
})

it('posts a fresh offer when no other tab holds the link (page reload reconnect)', async () => {
  const link = new WebGameLink('walk')
  await link.start({ takeover: false })
  expect(actions).toEqual(['reset', 'offer'])
  expect(peer.createOffer).toHaveBeenCalled()
  link.stop()
})

it('does not reset or steal while another tab still has a live link', async () => {
  room = { webConnected: true, updatedAt: Date.now() }
  const onIdle = jest.fn()
  const link = new WebGameLink('walk', { onIdle })
  const started = link.start({ takeover: false })
  for (let i = 0; i < 20 && !onIdle.mock.calls.length; i++) await Promise.resolve()
  expect(onIdle).toHaveBeenCalled()
  expect(actions).toEqual([])
  room.webConnected = false
  await jest.advanceTimersByTimeAsync(10_000)
  for (let i = 0; i < 20 && actions.length === 0; i++) await Promise.resolve()
  await started
  expect(actions).toEqual(['reset', 'offer'])
  link.stop()
})

it('restart / takeover posts even when the room looks held', async () => {
  room = { webConnected: true, updatedAt: Date.now() }
  const link = new WebGameLink('walk')
  await link.start({ takeover: true })
  expect(actions).toEqual(['reset', 'offer'])
  link.stop()
})

it('stops polling for an answer after the wait window', async () => {
  const onIdle = jest.fn()
  const link = new WebGameLink('walk', { onIdle })
  await link.start()
  expect(actions).toEqual(['reset', 'offer'])
  jest.advanceTimersByTime(10 * 60_000)
  expect(onIdle).toHaveBeenCalled()
  const gets = (globalThis.fetch as jest.Mock).mock.calls.filter(([u, init]) => !init && String(u).includes('roomId=walk')).length
  jest.advanceTimersByTime(60_000)
  const later = (globalThis.fetch as jest.Mock).mock.calls.filter(([u, init]) => !init && String(u).includes('roomId=walk')).length
  expect(later).toBe(gets)
  link.stop()
})
