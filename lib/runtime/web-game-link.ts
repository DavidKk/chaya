'use client'

import { readCloudLinkToken } from '@/lib/browser/link-token'
import type { LogLevel } from '@/lib/log/types'
import { encodeGameLinkMessage, GAME_LINK_CHANNEL, GAME_LINK_TOKEN_HEADER, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createChunkReceiver } from '@/lib/runtime/link-chunks'
import { sendTranslationPacket } from '@/lib/runtime/translation-rpc'
import { defaultPeerConfig, normalizeLocalWebRtcDescription, waitForIceGathering } from '@/lib/runtime/webrtc-ice'

type Handlers = {
  onConnected?: () => void
  onDisconnected?: () => void
  onMessage?: (msg: GameLinkMessage) => void
  onTrack?: (stream: MediaStream) => void
  /** Cease active negotiation if another tab claims the link or answer times out */
  onIdle?: () => void
  onLog?: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void
}

const SIGNAL_URL = '/api/runtime/webrtc'
const ANSWER_POLL_MS = 8_000
/** Signaling room expires after 10 minutes of inactivity */
const ANSWER_WAIT_MS = 10 * 60_000
/** Connected tabs refresh webConnected every 30s */
const LIVE_LINK_MAX_AGE_MS = 45_000
const HELD_RECHECK_MS = 10_000

/** Browser mode tokens; omitted in standalone server sessions */
function signalHeaders(roomId: string, extra?: Record<string, string>): Record<string, string> {
  const token = readCloudLinkToken(roomId)
  return token ? { ...extra, [GAME_LINK_TOKEN_HEADER]: token } : { ...extra }
}

async function postSignal(body: { roomId: string } & Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(SIGNAL_URL, {
      method: 'POST',
      headers: signalHeaders(body.roomId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (!res.ok) return false
    await res.json().catch(() => null)
    return true
  } catch {
    // Common during HMR/unload/network blips; ensure disconnect handler does not throw unhandledRejections
    return false
  }
}

type Room = { offer?: RTCSessionDescriptionInit | null; answer?: RTCSessionDescriptionInit | null; webConnected?: boolean; updatedAt?: number }

async function getRoom(roomId: string): Promise<Room | null | undefined> {
  const res = await fetch(`${SIGNAL_URL}?roomId=${encodeURIComponent(roomId)}`, { headers: signalHeaders(roomId) })
  if (!res.ok) throw new Error(`signaling get ${res.status}`)
  const data = (await res.json()) as { room?: Room | null }
  return data.room
}

/** Another tab's DataChannel is open and still sending keepalives */
async function linkHeldElsewhere(roomId: string): Promise<boolean> {
  try {
    const room = await getRoom(roomId)
    if (!room) return false
    const age = Date.now() - Number(room.updatedAt || 0)
    if (room.webConnected && age < LIVE_LINK_MAX_AGE_MS) return true
    if (room.offer && age < LIVE_LINK_MAX_AGE_MS) return true
    return false
  } catch {
    return false
  }
}

/**
 * Web client: Creates DataChannel + offer, awaits answer from game.
 * Connected = online; Disconnected = offline.
 */
export class WebGameLink {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private heldTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  /** Bumped by every start / stop so a superseded start stops at its next await */
  private run = 0
  private chunks = createChunkReceiver((msg) => this.handlers.onMessage?.(msg as GameLinkMessage))
  connected = false
  private mediaStream: MediaStream | null = null

  get stream(): MediaStream | null {
    return this.mediaStream
  }

  constructor(
    readonly roomId: string,
    private handlers: Handlers = {}
  ) {}

  /** Update callbacks across React remounts without recreating PeerConnection */
  setHandlers(handlers: Handlers) {
    this.handlers = handlers
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    this.handlers.onLog?.(level, message, meta)
  }

  /**
   * Resets the room and posts a fresh offer, then polls for the game's answer for up to `ANSWER_WAIT_MS`.
   * `takeover: false` (background auto start) leaves a room alone while another tab holds a live link,
   * rechecking until it frees up or the wait runs out; an explicit restart takes over.
   */
  async start({ takeover = true, enableMedia = false }: { takeover?: boolean; enableMedia?: boolean } = {}) {
    this.stop({ silent: true })
    this.closed = false
    const run = this.run
    const deadline = Date.now() + ANSWER_WAIT_MS
    this.log('info', `Starting WebGameLink stream connection (room: ${this.roomId})`, { takeover, enableMedia })
    if (!takeover && !(await this.waitUntilFree(run, deadline))) {
      this.log('warn', 'Found active connection occupying room; yielded negotiation')
      return
    }
    if (!this.live(run)) return
    this.log('debug', 'Sending signaling reset request')
    if (!(await postSignal({ action: 'reset', roomId: this.roomId }))) {
      this.log('fail', 'Failed to reset signaling room')
      throw new Error('signaling reset failed')
    }

    const pc = new RTCPeerConnection(defaultPeerConfig())
    this.pc = pc
    this.log('debug', 'Initialized RTCPeerConnection and DataChannel')
    const dc = pc.createDataChannel(GAME_LINK_CHANNEL, { ordered: true })
    this.dc = dc
    this.bindChannel(dc)

    if (enableMedia && typeof pc.addTransceiver === 'function') {
      try {
        const trVideo = pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })
        const RTCCapabilities = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver : null
        if (typeof RTCCapabilities?.getCapabilities === 'function' && typeof trVideo.setCodecPreferences === 'function') {
          const caps = RTCCapabilities.getCapabilities('video')
          if (caps?.codecs) {
            const h264 = caps.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'video/h264')
            const others = caps.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'video/h264')
            if (h264.length > 0) {
              trVideo.setCodecPreferences([...h264, ...others])
            }
            this.log('info', 'Registered transceiver and configured H.264 preference')
          }
        }
      } catch {
        /* */
      }
    }

    let remoteStream: MediaStream | null = null
    pc.ontrack = (ev) => {
      try {
        if (ev.receiver) {
          if ('playoutDelayHint' in ev.receiver) (ev.receiver as any).playoutDelayHint = 0
          if ('jitterBufferTarget' in ev.receiver) (ev.receiver as any).jitterBufferTarget = 0
        }
      } catch {}
      if (ev.streams && ev.streams[0]) {
        remoteStream = ev.streams[0]
      } else {
        if (!remoteStream) remoteStream = new MediaStream()
        remoteStream.addTrack(ev.track)
      }
      this.log('ok', `Received remote media track: ${ev.track.kind} (${ev.track.label || 'default'})`, { trackId: ev.track.id, readyState: ev.track.readyState })
      this.mediaStream = remoteStream
      this.handlers.onTrack?.(remoteStream)
    }

    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState
      this.log(ice === 'failed' ? 'fail' : ice === 'connected' || ice === 'completed' ? 'ok' : 'info', `ICE connection state changed: ${ice}`)
      if (ice === 'failed') {
        this.clearDisconnectTimer()
        this.markDisconnected()
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      this.log(state === 'failed' ? 'fail' : state === 'connected' ? 'ok' : 'info', `WebRTC PeerConnection state changed: ${state}`)
      if (state === 'failed' || state === 'closed') {
        this.clearDisconnectTimer()
        this.markDisconnected()
        return
      }
      // 'disconnected' state can recover; give a short grace period
      if (state === 'disconnected') {
        this.armDisconnectTimer()
        return
      }
      if (state === 'connected' || state === 'connecting') {
        this.clearDisconnectTimer()
      }
    }

    await pc.setLocalDescription(await pc.createOffer())
    this.log('debug', 'Created SDP Offer, gathering local ICE candidates...')
    await waitForIceGathering(pc)
    if (!this.live(run) || this.pc !== pc) return
    const offer = normalizeLocalWebRtcDescription(pc.localDescription!.toJSON())
    this.log('debug', 'Local ICE gathering complete, submitting SDP Offer')
    if (!(await postSignal({ action: 'offer', roomId: this.roomId, sdp: offer }))) {
      this.log('fail', 'Failed to submit SDP Offer to signaling service')
      throw new Error('signaling offer failed')
    }
    this.log('info', 'SDP Offer submitted, waiting for answer from game')
    if (!this.live(run)) return

    void this.pollAnswer()
    setTimeout(() => { if (this.live(run) && this.pc && !this.pc.remoteDescription) void this.pollAnswer() }, 300)
    setTimeout(() => { if (this.live(run) && this.pc && !this.pc.remoteDescription) void this.pollAnswer() }, 650)
    this.pollTimer = setInterval(() => {
      if (Date.now() < deadline && !this.pc?.remoteDescription) {
        return void this.pollAnswer()
      }
      this.clearPoll()
      if (!this.connected) this.handlers.onIdle?.()
    }, 1_000)
  }

  private live(run: number) {
    return !this.closed && run === this.run
  }

  private async waitUntilFree(run: number, deadline: number): Promise<boolean> {
    let reported = false
    while (this.live(run)) {
      if (!(await linkHeldElsewhere(this.roomId))) return this.live(run)
      if (!reported) {
        reported = true
        this.handlers.onIdle?.()
      }
      if (!this.live(run) || Date.now() + HELD_RECHECK_MS > deadline) return false
      await new Promise<void>((resolve) => {
        this.heldTimer = setTimeout(() => {
          this.heldTimer = null
          resolve()
        }, HELD_RECHECK_MS)
      })
    }
    return false
  }

  private clearPoll() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollAnswer(): Promise<boolean> {
    if (this.closed || !this.pc || this.pc.remoteDescription) return false
    try {
      const room = await getRoom(this.roomId)
      const answer = room?.answer
      if (!answer?.type || !answer.sdp) return false
      await this.pc.setRemoteDescription(answer)
      this.log('ok', 'Received SDP Answer and set remote description')
      this.clearPoll()
      return true
    } catch {
      return false
    }
  }

  private bindChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      this.log('ok', 'WebRTC DataChannel established')
      this.clearDisconnectTimer()
      this.connected = true
      void postSignal({ action: 'connected', roomId: this.roomId, connected: true })
      this.startConnectedKeepalive()
      this.send({ type: 'hello', role: 'web', gameId: this.roomId })
      this.handlers.onConnected?.()
    }
    dc.onclose = () => {
      this.log('warn', 'WebRTC DataChannel closed')
      this.markDisconnected()
    }
    dc.onerror = () => {
      this.log('warn', 'WebRTC DataChannel error event')
      /* onclose will follow; avoid duplicate jitter */
    }
    dc.onmessage = (ev) => {
      const msg = parseGameLinkMessage(String(ev.data || ''))
      if (!msg) return
      if (msg.type === 'ping') this.send({ type: 'pong', t: msg.t })
      if (msg.type === 'link.chunk') return this.chunks.receive(msg)
      this.handlers.onMessage?.(msg)
    }
  }

  /** Refresh webConnected timestamp on signaling board */
  private startConnectedKeepalive() {
    this.clearKeepalive()
    this.keepaliveTimer = setInterval(() => {
      if (!this.connected || this.closed) {
        this.clearKeepalive()
        return
      }
      void postSignal({ action: 'connected', roomId: this.roomId, connected: true })
    }, 30_000)
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.releaseOnUnload)
  }

  private clearKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.releaseOnUnload)
  }

  /** A reloaded page must not see its own previous link as another tab holding the room */
  private releaseOnUnload = () => {
    if (!this.connected) return
    try {
      void fetch(SIGNAL_URL, {
        method: 'POST',
        keepalive: true,
        headers: signalHeaders(this.roomId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'connected', roomId: this.roomId, connected: false }),
      }).catch(() => {})
    } catch {
      /* */
    }
  }

  private armDisconnectTimer() {
    this.clearDisconnectTimer()
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null
      if (this.pc?.connectionState === 'disconnected' || this.pc?.connectionState === 'failed') {
        this.markDisconnected()
      }
    }, 3_000)
  }

  private clearDisconnectTimer() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer)
      this.disconnectTimer = null
    }
  }

  private markDisconnected() {
    this.clearDisconnectTimer()
    this.clearKeepalive()
    const was = this.connected
    this.log('warn', 'WebGameLink marked as disconnected')
    this.connected = false
    void postSignal({ action: 'connected', roomId: this.roomId, connected: false })
    if (was) this.handlers.onDisconnected?.()
  }

  send(msg: GameLinkMessage) {
    if (msg.type === 'translation.rpc') return sendTranslationPacket(this.dc, msg)
    if (this.dc?.readyState === 'open') this.dc.send(encodeGameLinkMessage(msg))
  }

  quit(reason?: string) {
    this.send({ type: 'quit', reason })
  }

  stop(opts?: { silent?: boolean }) {
    this.closed = true
    this.run += 1
    this.chunks.dispose()
    this.clearDisconnectTimer()
    this.clearKeepalive()
    this.clearPoll()
    if (this.heldTimer) {
      clearTimeout(this.heldTimer)
      this.heldTimer = null
    }
    try {
      this.dc?.close()
    } catch {
      /* */
    }
    try {
      this.pc?.close()
    } catch {
      /* */
    }
    this.dc = null
    this.pc = null
    this.mediaStream = null
    if (this.connected) {
      this.connected = false
      void postSignal({ action: 'connected', roomId: this.roomId, connected: false })
      if (!opts?.silent) this.handlers.onDisconnected?.()
    }
  }
}
