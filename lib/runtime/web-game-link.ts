'use client'

import { readCloudLinkToken } from '@/lib/browser/link-token'
import { encodeGameLinkMessage, GAME_LINK_CHANNEL, GAME_LINK_TOKEN_HEADER, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createChunkReceiver } from '@/lib/runtime/link-chunks'
import { sendTranslationPacket } from '@/lib/runtime/translation-rpc'
import { defaultPeerConfig, normalizeLocalWebRtcDescription, waitForIceGathering } from '@/lib/runtime/webrtc-ice'

type Handlers = {
  onConnected?: () => void
  onDisconnected?: () => void
  onMessage?: (msg: GameLinkMessage) => void
  /** 不再主动协商且没连上：别的标签页占着链路，或等 answer 超时 */
  onIdle?: () => void
}

const SIGNAL_URL = '/api/runtime/webrtc'
const ANSWER_POLL_MS = 8_000
/** 信令房间 10 分钟无写入即过期，过后再轮询也等不到 answer */
const ANSWER_WAIT_MS = 10 * 60_000
/** 连上的标签页每 30s 刷新 webConnected，超过这个间隔就当它已不在 */
const LIVE_LINK_MAX_AGE_MS = 45_000
const HELD_RECHECK_MS = 10_000

/** 浏览器模式才有令牌（服务端模式走管理会话），没有就不带 */
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
    // HMR / 页卸载 / 服务短暂不可达时常见；断线回调里绝不能抛成 unhandledRejection
    return false
  }
}

type Room = { answer?: RTCSessionDescriptionInit | null; webConnected?: boolean; updatedAt?: number }

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
    return !!room?.webConnected && Date.now() - Number(room.updatedAt || 0) < LIVE_LINK_MAX_AGE_MS
  } catch {
    return false
  }
}

/**
 * Web 侧：同时支持双通道传输（WebRTC DataChannel 与本地 WebSocket Relay）。
 * 任意一路连上 = 在线；断开 = 离线。
 */
export class WebGameLink {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private ws: WebSocket | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private heldTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  /** Bumped by every start / stop so a superseded start stops at its next await */
  private run = 0
  private chunks = createChunkReceiver((msg) => this.handlers.onMessage?.(msg as GameLinkMessage))
  connected = false

  constructor(
    readonly roomId: string,
    private handlers: Handlers = {}
  ) {}

  /** React 重挂时更新回调，不重建 PeerConnection */
  setHandlers(handlers: Handlers) {
    this.handlers = handlers
  }

  /**
   * Resets the room and posts a fresh offer, then polls for the game's answer for up to `ANSWER_WAIT_MS`.
   * Also connects to local WebSocket relay concurrently.
   */
  async start({ takeover = true }: { takeover?: boolean } = {}) {
    this.stop({ silent: true })
    this.closed = false
    const run = this.run
    const deadline = Date.now() + ANSWER_WAIT_MS

    // Start WebSocket bridge connection in parallel
    this.startWs(run)

    if (!takeover && !(await this.waitUntilFree(run, deadline))) return
    if (!this.live(run)) return
    if (!(await postSignal({ action: 'reset', roomId: this.roomId }))) {
      throw new Error('signaling reset failed')
    }

    const pc = new RTCPeerConnection(defaultPeerConfig())
    this.pc = pc
    const dc = pc.createDataChannel(GAME_LINK_CHANNEL, { ordered: true })
    this.dc = dc
    this.bindChannel(dc)

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'failed' || state === 'closed') {
        this.clearDisconnectTimer()
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.markDisconnected()
        }
        return
      }
      if (state === 'disconnected') {
        this.armDisconnectTimer()
        return
      }
      if (state === 'connected' || state === 'connecting') {
        this.clearDisconnectTimer()
      }
    }

    await pc.setLocalDescription(await pc.createOffer())
    await waitForIceGathering(pc)
    if (!this.live(run) || this.pc !== pc) return
    const offer = normalizeLocalWebRtcDescription(pc.localDescription!.toJSON())
    if (!(await postSignal({ action: 'offer', roomId: this.roomId, sdp: offer }))) {
      throw new Error('signaling offer failed')
    }
    if (!this.live(run)) return

    void this.pollAnswer()
    this.pollTimer = setInterval(() => {
      if (Date.now() < deadline) return void this.pollAnswer()
      this.clearPoll()
      if (!this.connected) this.handlers.onIdle?.()
    }, ANSWER_POLL_MS)
  }

  private startWs(run: number) {
    if (typeof window === 'undefined') return
    try {
      const wsUrl = `ws://127.0.0.1:3928/?role=web&roomId=${encodeURIComponent(this.roomId)}`
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.onopen = () => {
        if (!this.live(run) || this.ws !== ws) {
          ws.close()
          return
        }
        this.clearDisconnectTimer()
        this.connected = true
        void postSignal({ action: 'connected', roomId: this.roomId, connected: true })
        this.startConnectedKeepalive()
        this.send({ type: 'hello', role: 'web', gameId: this.roomId })
        this.handlers.onConnected?.()
      }

      ws.onmessage = (ev) => {
        if (!this.live(run)) return
        const msg = parseGameLinkMessage(String(ev.data || ''))
        if (!msg) return
        if (msg.type === 'ping') this.send({ type: 'pong', t: msg.t })
        if (msg.type === 'link.chunk') return this.chunks.receive(msg)
        this.handlers.onMessage?.(msg)
      }

      ws.onclose = () => {
        if (!this.live(run) || this.ws !== ws) return
        this.ws = null
        if (!this.dc || this.dc.readyState !== 'open') {
          this.markDisconnected()
        }
      }

      ws.onerror = () => {
        /* Handled by onclose */
      }
    } catch {
      // Ignore WebSocket connection failures on non-loopback or restricted environments
    }
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
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollAnswer() {
    if (this.closed || !this.pc || this.pc.remoteDescription) return
    try {
      const room = await getRoom(this.roomId)
      const answer = room?.answer
      if (!answer?.type) return
      await this.pc.setRemoteDescription(answer)
      this.clearPoll()
    } catch {
      /* ignore */
    }
  }

  private bindChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      this.clearDisconnectTimer()
      this.connected = true
      void postSignal({ action: 'connected', roomId: this.roomId, connected: true })
      this.startConnectedKeepalive()
      this.send({ type: 'hello', role: 'web', gameId: this.roomId })
      this.handlers.onConnected?.()
    }
    dc.onclose = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.markDisconnected()
      }
    }
    dc.onerror = () => {
      /* onclose 会跟进；避免 error 与 close 双触发抖动 */
    }
    dc.onmessage = (ev) => {
      const msg = parseGameLinkMessage(String(ev.data || ''))
      if (!msg) return
      if (msg.type === 'ping') this.send({ type: 'pong', t: msg.t })
      if (msg.type === 'link.chunk') return this.chunks.receive(msg)
      this.handlers.onMessage?.(msg)
    }
  }

  /** 刷新信令板 webConnected 时间戳，避免标签页崩溃后永久锁启动 */
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
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.markDisconnected()
        }
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
    this.connected = false
    void postSignal({ action: 'connected', roomId: this.roomId, connected: false })
    if (was) this.handlers.onDisconnected?.()
  }

  send(msg: GameLinkMessage) {
    if (msg.type === 'translation.rpc') return sendTranslationPacket(this.dc, msg)
    const encoded = encodeGameLinkMessage(msg)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encoded)
      return
    }
    if (this.dc?.readyState === 'open') {
      this.dc.send(encoded)
    }
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
      this.ws?.close()
    } catch {
      /* */
    }
    this.ws = null
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
    if (this.connected) {
      this.connected = false
      void postSignal({ action: 'connected', roomId: this.roomId, connected: false })
      if (!opts?.silent) this.handlers.onDisconnected?.()
    }
  }
}
