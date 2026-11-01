/**
 * Embedded WebRTC Gateway for RGSS Overlay.
 * Runs inside WKWebView / WebView2, negotiates with local / edge console via WebRTC signaling,
 * and exchanges DataChannel packets directly with zero server-side relay bandwidth.
 */

import { encodeGameLinkMessage, GAME_LINK_TOKEN_HEADER, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createChunkReceiver, sendChunked } from '@/lib/runtime/link-chunks'
import { defaultPeerConfig, normalizeLocalWebRtcDescription, waitForIceGathering } from '@/lib/runtime/webrtc-ice'

import { type SpectatorOffer, SpectatorPeers } from './spectator-peers'
import { WindowFrameSource } from './window-frame-source'

export type GatewayHandlers = {
  onConnected?: () => void
  onDisconnected?: () => void
  onMessage?: (msg: GameLinkMessage) => void
}

const POLL_IDLE_MS = 6_000
const POLL_LINKED_MS = 2_000
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

  private observerPc: RTCPeerConnection | null = null
  private lastObserverOfferSdp: string | null = null
  private observerAnswering = false
  private frameSource = new WindowFrameSource((message) => {
    console.warn('[RGSS capture]', message)
    this.closePeer()
    this.closeObserver()
    this.spectators?.stop()
    this.schedule(RECONNECT_POLL_MS)
  })
  private mediaPeers = new Set<RTCPeerConnection>()
  private spectators: SpectatorPeers

  private releaseMedia(peer: RTCPeerConnection | null) {
    if (peer) this.mediaPeers.delete(peer)
    if (!this.mediaPeers.size) this.frameSource.stop()
  }

  private preferH264(peer: RTCPeerConnection) {
    try {
      const RTCSender = (globalThis as unknown as { RTCRtpSender?: { getCapabilities?: (kind: string) => { codecs?: { mimeType: string }[] } } }).RTCRtpSender
      if (typeof RTCSender?.getCapabilities === 'function') {
        const caps = RTCSender.getCapabilities('video')
        if (caps?.codecs) {
          const h264 = caps.codecs.filter((codec) => codec.mimeType?.toLowerCase() === 'video/h264')
          const others = caps.codecs.filter((codec) => codec.mimeType?.toLowerCase() !== 'video/h264')
          if (h264.length > 0) {
            for (const tr of peer.getTransceivers?.() || []) {
              if (tr.receiver?.track?.kind === 'video' && typeof tr.setCodecPreferences === 'function') {
                tr.setCodecPreferences([...h264, ...others] as any)
              }
            }
          }
        }
      }
    } catch {}
  }

  private async attachVideoTrack(peer: RTCPeerConnection) {
    this.mediaPeers.add(peer)
    try {
      const stream = await this.frameSource.start()
      if (!this.started || !this.mediaPeers.has(peer)) return
      for (const track of stream.getVideoTracks()) {
        track.contentHint = 'motion'
        peer.addTrack(track, stream)
      }
      this.preferH264(peer)
      for (const sender of peer.getSenders?.() || []) {
        if (sender.track?.kind !== 'video') continue
        try {
          const parameters = sender.getParameters()
          if (!parameters.encodings?.length) parameters.encodings = [{}]
          parameters.encodings[0].maxBitrate = 8_000_000
          parameters.encodings[0].maxFramerate = 30
          parameters.degradationPreference = 'maintain-framerate'
          await sender.setParameters(parameters)
        } catch {
          /* Encoder limits are optional on older WebKit versions. */
        }
      }
    } catch (error) {
      this.releaseMedia(peer)
      throw error
    }
  }

  constructor(
    readonly roomId: string,
    apiBase: string,
    private handlers: GatewayHandlers = {},
    private credentials: { linkToken?: string; launchToken?: string; enableObserver?: boolean } = {}
  ) {
    this.apiBase = String(apiBase || '').replace(/\/+$/, '')
    this.spectators = new SpectatorPeers(
      roomId,
      (peer) => this.attachVideoTrack(peer),
      (peer) => this.releaseMedia(peer),
      async (peerId, sdp) => {
        const response = await fetch(`${this.apiBase}/api/runtime/webrtc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.signalHeaders() },
          body: JSON.stringify({ action: 'answer', roomId, peerId, sdp }),
        })
        return response.ok
      }
    )
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
    this.closeObserver()
    this.spectators.stop()
    this.frameSource.stop()
  }

  private closeObserver() {
    const peer = this.observerPc
    this.observerPc = null
    this.lastObserverOfferSdp = null
    if (peer) {
      peer.onconnectionstatechange = null
      peer.close()
    }
    this.releaseMedia(peer)
  }

  private closePeer() {
    this.chunks.dispose()
    const dc = this.dc
    const pc = this.pc
    this.dc = null
    this.pc = null
    this.linkOpen = false
    this.lastOfferSdp = null
    this.releaseMedia(pc)
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
    if (this.started && generation === this.generation && this.credentials.enableObserver) {
      try {
        await this.tryAnswerObserver()
      } catch (error) {
        console.warn('[RGSS WebRTC Gateway] Observer handshake failed:', error)
        if (generation === this.generation) this.closeObserver()
      }
    }
    if (generation !== this.generation) return
    this.schedule(this.linkOpen || this.observerPc ? POLL_LINKED_MS : POLL_IDLE_MS)
  }

  private async tryAnswer(): Promise<boolean> {
    if (this.answering || !this.roomId) return false
    const generation = this.generation
    type Room = { offer?: RTCSessionDescriptionInit | null; spectators?: SpectatorOffer[] }
    let roomData: Room | null = null

    try {
      const res = await fetch(`${this.apiBase}/api/runtime/webrtc?roomId=${encodeURIComponent(this.roomId)}`, { headers: this.signalHeaders() })
      if (!res.ok) return false
      const body = (await res.json()) as { room?: Room | null }
      roomData = body?.room || null
    } catch {
      return false
    }

    if (!this.started || generation !== this.generation) return false
    await this.spectators.sync(roomData?.spectators || [], () => this.started && generation === this.generation)
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
      if (!this.started || this.pc !== peer) return false
      if (offer.sdp.includes('m=video')) await this.attachVideoTrack(peer)
      if (!this.started || this.pc !== peer) return false
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

  private async tryAnswerObserver(): Promise<boolean> {
    if (this.observerAnswering || !this.roomId) return false
    const obsRoomId = `${this.roomId}:observer`
    const generation = this.generation
    let roomData: { offer?: RTCSessionDescriptionInit | null } | null = null

    try {
      const res = await fetch(`${this.apiBase}/api/runtime/webrtc?roomId=${encodeURIComponent(obsRoomId)}`, { headers: this.signalHeaders() })
      if (res.ok) {
        const body = (await res.json()) as { room?: { offer?: RTCSessionDescriptionInit | null } | null }
        roomData = body?.room || null
      }
    } catch {
      return false
    }

    const offer = roomData?.offer
    if (!offer?.type || !offer.sdp) return false
    if (offer.sdp === this.lastObserverOfferSdp && this.observerPc) return false

    if (!this.started || generation !== this.generation) return false
    this.observerAnswering = true
    try {
      this.closeObserver()

      const peer = new RTCPeerConnection(defaultPeerConfig())
      this.observerPc = peer
      this.lastObserverOfferSdp = offer.sdp

      peer.onconnectionstatechange = () => {
        const state = peer.connectionState
        if (this.observerPc === peer && (state === 'failed' || state === 'closed')) {
          this.closeObserver()
        }
      }

      await peer.setRemoteDescription(offer)
      if (!this.started || this.observerPc !== peer) return false
      if (offer.sdp.includes('m=video')) await this.attachVideoTrack(peer)
      if (!this.started || this.observerPc !== peer) return false
      await peer.setLocalDescription(await peer.createAnswer())
      await waitForIceGathering(peer)

      if (!this.started || this.observerPc !== peer) return false
      const answer = normalizeLocalWebRtcDescription(peer.localDescription!.toJSON())

      const postRes = await fetch(`${this.apiBase}/api/runtime/webrtc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.signalHeaders() },
        body: JSON.stringify({ action: 'answer', roomId: obsRoomId, sdp: answer }),
      })

      if (!postRes.ok && this.observerPc === peer) {
        this.closeObserver()
      }
      return postRes.ok
    } finally {
      this.observerAnswering = false
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
