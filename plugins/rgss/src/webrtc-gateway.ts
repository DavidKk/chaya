/**
 * Embedded WebRTC Gateway for RGSS Overlay.
 * Runs inside WKWebView / WebView2, negotiates with local / edge console via WebRTC signaling,
 * and exchanges DataChannel packets directly with zero server-side relay bandwidth.
 */

import { encodeGameLinkMessage, GAME_LINK_TOKEN_HEADER, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createChunkReceiver, sendChunked } from '@/lib/runtime/link-chunks'
import { defaultPeerConfig, normalizeLocalWebRtcDescription, waitForIceGathering } from '@/lib/runtime/webrtc-ice'

export type GatewayHandlers = {
  onConnected?: () => void
  onDisconnected?: () => void
  onMessage?: (msg: GameLinkMessage) => void
}

const POLL_IDLE_MS = 6_000
const POLL_LINKED_MS = 20_000
const RECONNECT_POLL_MS = 1_000

export class RgssWebRtcGateway {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private started = false
  private linkOpen = false
  private answering = false
  private lastOfferSdp: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private sendQueue = Promise.resolve()
  private sendingChunk = false
  private chunks = createChunkReceiver((message) => this.handlers.onMessage?.(message as GameLinkMessage))
  private apiBase: string

  constructor(
    readonly roomId: string,
    apiBase: string,
    private handlers: GatewayHandlers = {},
    private credentials: { linkToken?: string; launchToken?: string } = {}
  ) {
    this.apiBase = String(apiBase || '').replace(/\/+$/, '')
  }

  setHandlers(handlers: GatewayHandlers) {
    this.handlers = handlers
  }

  start() {
    if (this.started) return
    this.started = true
    this.generation += 1
    void this.loop()
  }

  stop() {
    this.started = false
    this.generation += 1
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.closePeer()
  }

  private closePeer() {
    this.chunks.dispose()
    const dc = this.dc
    const pc = this.pc
    this.dc = null
    this.pc = null
    this.linkOpen = false
    this.lastOfferSdp = null
    if (dc) {
      dc.onopen = dc.onclose = dc.onmessage = dc.onerror = null
      try {
        dc.close()
      } catch {
        /* Already closed. */
      }
    }
    if (pc) {
      pc.ondatachannel = pc.onconnectionstatechange = null
      try {
        pc.close()
      } catch {
        /* Already closed. */
      }
    }
  }

  private signalHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.credentials.linkToken) headers[GAME_LINK_TOKEN_HEADER] = this.credentials.linkToken
    if (this.credentials.launchToken) headers['X-Chaya-Launch-Token'] = this.credentials.launchToken
    return headers
  }

  send(msg: GameLinkMessage) {
    if (!this.dc || this.dc.readyState !== 'open') return
    const dc = this.dc
    const encoded = encodeGameLinkMessage(msg)
    if (encoded.length <= 4096 && !this.sendingChunk) {
      try {
        dc.send(encoded)
      } catch (err) {
        console.warn('[RGSS WebRTC Gateway] Send error:', err)
      }
      return
    }
    this.sendingChunk = true
    this.sendQueue = this.sendQueue
      .then(async () => {
        if (this.dc !== dc || dc.readyState !== 'open') return
        if (encoded.length <= 4096) {
          dc.send(encoded)
          return
        }
        await sendChunked((packet) => {
          if (this.dc !== dc || dc.readyState !== 'open') throw new Error('RGSS channel closed during transfer')
          dc.send(encodeGameLinkMessage(packet))
        }, msg)
      })
      .catch((err) => {
        console.warn('[RGSS WebRTC Gateway] Send error:', err)
      })
      .finally(() => {
        this.sendingChunk = false
      })
  }

  private schedule(ms: number) {
    if (!this.started) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.loop()
    }, ms)
  }

  private async loop() {
    if (!this.started) return
    const generation = this.generation
    try {
      await this.tryAnswer()
    } catch (err) {
      console.warn('[RGSS WebRTC Gateway] Handshake failed:', err)
      if (generation === this.generation) this.closePeer()
    }
    if (generation !== this.generation) return
    this.schedule(this.linkOpen ? POLL_LINKED_MS : POLL_IDLE_MS)
  }

  private async tryAnswer(): Promise<boolean> {
    if (this.answering || !this.roomId) return false
    const generation = this.generation
    let roomData: { offer?: RTCSessionDescriptionInit | null } | null = null

    try {
      const res = await fetch(`${this.apiBase}/api/runtime/webrtc?roomId=${encodeURIComponent(this.roomId)}`, { headers: this.signalHeaders() })
      if (res.ok) {
        const body = (await res.json()) as { room?: { offer?: RTCSessionDescriptionInit | null } | null }
        roomData = body?.room || null
      }
    } catch {
      return false
    }

    if (!this.started || generation !== this.generation) return false
    const offer = roomData?.offer
    if (!offer?.type || !offer.sdp) return false
    if (offer.sdp === this.lastOfferSdp && this.pc) return false

    this.answering = true
    try {
      this.closePeer()

      const peer = new RTCPeerConnection(defaultPeerConfig())
      this.pc = peer
      this.lastOfferSdp = offer.sdp

      peer.ondatachannel = (ev) => {
        if (ev.channel && this.started && this.pc === peer) this.bindChannel(ev.channel)
      }

      peer.onconnectionstatechange = () => {
        const state = peer.connectionState
        if (this.pc === peer && (state === 'failed' || state === 'closed')) {
          this.closePeer()
          this.handlers.onDisconnected?.()
        }
      }

      await peer.setRemoteDescription(offer)
      await peer.setLocalDescription(await peer.createAnswer())
      await waitForIceGathering(peer)

      if (!this.started || this.pc !== peer) return false
      const answer = normalizeLocalWebRtcDescription(peer.localDescription!.toJSON())

      const postRes = await fetch(`${this.apiBase}/api/runtime/webrtc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.signalHeaders() },
        body: JSON.stringify({ action: 'answer', roomId: this.roomId, sdp: answer }),
      })

      if (!postRes.ok && this.pc === peer) this.closePeer()
      return postRes.ok
    } finally {
      this.answering = false
    }
  }

  private bindChannel(dc: RTCDataChannel) {
    this.dc = dc
    dc.onopen = () => {
      if (!this.started || this.dc !== dc) return
      this.linkOpen = true
      this.send({
        type: 'hello',
        role: 'game',
        gameId: this.roomId,
      })
      this.handlers.onConnected?.()
    }

    dc.onclose = () => {
      if (this.dc !== dc) return
      this.closePeer()
      this.handlers.onDisconnected?.()
      this.schedule(RECONNECT_POLL_MS)
    }

    dc.onmessage = (ev) => {
      if (!this.started || this.dc !== dc) return
      try {
        const msg = parseGameLinkMessage(String(ev.data || ''))
        if (!msg) return
        if (msg.type === 'link.chunk') return this.chunks.receive(msg)
        if (msg.type === 'ping') {
          this.send({ type: 'pong', t: msg.t })
          return
        }
        this.handlers.onMessage?.(msg)
      } catch (err) {
        console.warn('[RGSS WebRTC Gateway] onmessage error:', err)
      }
    }
  }
}
