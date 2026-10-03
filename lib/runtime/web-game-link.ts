'use client'

import { readCloudLinkToken } from '@/lib/browser/link-token'
import { encodeGameLinkMessage, GAME_LINK_CHANNEL, GAME_LINK_TOKEN_HEADER, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { sendTranslationPacket } from '@/lib/runtime/translation-rpc'
import { defaultPeerConfig, normalizeLocalWebRtcDescription, waitForIceGathering } from '@/lib/runtime/webrtc-ice'

type Handlers = {
  onConnected?: () => void
  onDisconnected?: () => void
  onMessage?: (msg: GameLinkMessage) => void
}

/** 浏览器模式才有令牌（服务端模式走管理会话），没有就不带 */
function signalHeaders(roomId: string, extra?: Record<string, string>): Record<string, string> {
  const token = readCloudLinkToken(roomId)
  return token ? { ...extra, [GAME_LINK_TOKEN_HEADER]: token } : { ...extra }
}

async function postSignal(body: { roomId: string } & Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/runtime/webrtc', {
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

async function getRoom(roomId: string) {
  const res = await fetch(`/api/runtime/webrtc?roomId=${encodeURIComponent(roomId)}`, { headers: signalHeaders(roomId) })
  if (!res.ok) throw new Error(`signaling get ${res.status}`)
  const data = (await res.json()) as { room?: { answer?: RTCSessionDescriptionInit | null } }
  return data.room
}

/**
 * Web 侧：创建 DataChannel + offer，等游戏 answer。
 * 连上 = 在线；断开 = 离线。
 */
export class WebGameLink {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  connected = false

  constructor(
    readonly roomId: string,
    private handlers: Handlers = {}
  ) {}

  /** React 重挂时更新回调，不重建 PeerConnection */
  setHandlers(handlers: Handlers) {
    this.handlers = handlers
  }

  async start() {
    this.stop({ silent: true })
    this.closed = false
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
        this.markDisconnected()
        return
      }
      // disconnected 常可恢复，给短暂宽限，避免误切回「开始」
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
    if (this.closed || this.pc !== pc) return
    const offer = normalizeLocalWebRtcDescription(pc.localDescription!.toJSON())
    if (!(await postSignal({ action: 'offer', roomId: this.roomId, sdp: offer }))) {
      throw new Error('signaling offer failed')
    }

    // 立刻问一次，之后慢轮询；避免亚秒级刷屏
    void this.pollAnswer()
    this.pollTimer = setInterval(() => {
      void this.pollAnswer()
    }, 8_000)
  }

  private async pollAnswer() {
    if (this.closed || !this.pc || this.pc.remoteDescription) return
    try {
      const room = await getRoom(this.roomId)
      const answer = room?.answer
      if (!answer?.type) return
      await this.pc.setRemoteDescription(answer)
      if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
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
    dc.onclose = () => this.markDisconnected()
    dc.onerror = () => {
      /* onclose 会跟进；避免 error 与 close 双触发抖动 */
    }
    dc.onmessage = (ev) => {
      const msg = parseGameLinkMessage(String(ev.data || ''))
      if (!msg) return
      if (msg.type === 'ping') this.send({ type: 'pong', t: msg.t })
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
  }

  private clearKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
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
    this.clearDisconnectTimer()
    this.clearKeepalive()
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
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
    if (this.connected) {
      this.connected = false
      void postSignal({ action: 'connected', roomId: this.roomId, connected: false })
      if (!opts?.silent) this.handlers.onDisconnected?.()
    }
  }
}
