/**
 * Game-side WebRTC: poll signaling board for offers, answer, open DataChannel.
 * Keep the channel; handle quit / ping; edit.* goes to cheat via registerGameLinkEditHandlers.
 */

import { encodeGameLinkMessage, type GameLinkMessage, parseGameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createTranslationRpc, sendTranslationPacket } from '@/lib/runtime/translation-rpc'
import { installedTranslationRuntime } from '@/lib/translate/runtime-api'

import { ensureLaunchEnvGlobals } from '../env/ensure-launch-env'
import { resolveApiBase, resolveApiBaseFallbacks } from '../env/env'
import { chayaFetch, chayaPostJson } from '../net/http'
import { ChayaLog } from '../net/logger'
import { dispatchGameLinkEditMessage, stopGameLinkEditBridge } from './edit-link-bridge'
import { detectGameIdentity } from './game-identity'

const STUN = 'stun:stun.cloudflare.com:3478'
/** Disconnected: wait for Web offer; match console-side poll backoff */
const POLL_IDLE_MS = 8_000
/** Connected: only probe whether Web swapped in a new offer */
const POLL_LINKED_MS = 20_000

type Sdp = { type: RTCSdpType; sdp?: string }
type WebrtcRoom = { offer?: Sdp | null; answer?: Sdp | null }

export function gameRoomId(): string {
  try {
    const w = window as Window & { CHAYA_GAME_ID?: string; CHAYA_LAUNCH_TOKEN?: string }
    return String(w.CHAYA_GAME_ID || w.CHAYA_LAUNCH_TOKEN || '').trim() || 'default'
  } catch {
    return 'default'
  }
}

function hasLaunchRoom(): boolean {
  return gameRoomId() !== 'default'
}

function normalizeLocalSdp(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  const sdp = String(description.sdp || '')
  if (!sdp.includes('candidate:')) return description
  return {
    ...description,
    sdp: sdp.replace(/(\s)((?:[0-9]{1,3}\.){3}[0-9]{1,3})(\s)/g, (full, a, ip, b) => {
      if (ip === '127.0.0.1' || ip.startsWith('0.')) return full
      return `${a}127.0.0.1${b}`
    }),
  }
}

async function waitIce(peer: RTCPeerConnection, timeoutMs = 2_500) {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    let t = 0
    const onChange = () => {
      if (peer.iceGatheringState !== 'complete') return
      clearTimeout(t)
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    t = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }, timeoutMs)
    peer.addEventListener('icegatheringstatechange', onChange)
    onChange()
  })
}

function quitProcess() {
  ChayaLog.info('ChayaLink', '收到 Web 关闭指令，正在退出…')
  stopGameLink()
  try {
    const nw = (globalThis as { nw?: { App?: { quit?: () => void }; Window?: { get?: () => { close: (force?: boolean) => void } } } }).nw
    if (nw?.App?.quit) {
      nw.App.quit()
      return
    }
    const win = nw?.Window?.get?.()
    if (win?.close) {
      win.close(true)
      return
    }
  } catch {
    /* */
  }
  try {
    window.close()
  } catch {
    /* */
  }
}

function sendOnDc(dc: RTCDataChannel, msg: GameLinkMessage) {
  if (dc.readyState !== 'open') return
  try {
    dc.send(encodeGameLinkMessage(msg))
  } catch {
    /* */
  }
}

function bindDc(dc: RTCDataChannel) {
  const translation = createTranslationRpc(
    (packet) => {
      return sendTranslationPacket(dc, packet)
    },
    async (request, signal) => {
      const runtime = installedTranslationRuntime()
      if (!runtime) throw new Error('游戏翻译插件未就绪，请更新插件后重新打开游戏')
      return runtime.request(request, signal)
    }
  )
  dc.onopen = () => {
    linkOpen = true
    activeDc = dc
    const id = detectGameIdentity()
    sendOnDc(dc, {
      type: 'hello',
      role: 'game',
      gameId: gameRoomId(),
      name: id?.name,
      contentRoot: id?.contentRoot,
      gameRoot: id?.gameRoot,
    })
    ChayaLog.ok('ChayaLink', 'WebRTC DataChannel 已连接')
  }
  dc.onclose = () => {
    translation.dispose()
    if (activeDc === dc) activeDc = null
    linkOpen = false
    stopGameLinkEditBridge()
  }
  dc.onmessage = (ev) => {
    try {
      const msg = parseGameLinkMessage(String(ev.data || ''))
      if (!msg) return
      if (msg.type === 'translation.rpc') {
        translation.receive(msg)
        return
      }
      if (msg.type === 'quit') {
        quitProcess()
        return
      }
      if (msg.type === 'ping') {
        sendOnDc(dc, { type: 'pong', t: msg.t })
        return
      }
      dispatchGameLinkEditMessage(msg, (out) => sendOnDc(dc, out))
    } catch {
      /* */
    }
  }
}

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let pc: RTCPeerConnection | null = null
let activeDc: RTCDataChannel | null = null
let lastOfferSdp: string | null = null
let linkOpen = false
let answering = false

async function tryAnswer() {
  if (answering) return false
  if (!hasLaunchRoom()) ensureLaunchEnvGlobals()
  const id = gameRoomId()
  const bases = resolveApiBaseFallbacks()
  // Still on default: do not claim an empty room; wait for Env / console
  if (id === 'default') return false
  let room: WebrtcRoom | null = null
  for (const base of bases) {
    try {
      const res = await chayaFetch(`${base}/api/runtime/webrtc?roomId=${encodeURIComponent(id)}`)
      if (!res.ok) continue
      const data = (await res.json()) as { room?: WebrtcRoom | null }
      room = data.room || null
      break
    } catch {
      /* */
    }
  }
  if (!started) return false
  const offer = room?.offer
  if (!offer?.type || !offer.sdp) return false
  // Same offer already answered and peer still alive: skip
  if (offer.sdp === lastOfferSdp && pc) return false

  answering = true
  try {
    try {
      pc?.close()
    } catch {
      /* */
    }
    pc = null
    activeDc = null
    linkOpen = false
    stopGameLinkEditBridge()

    const peer = new RTCPeerConnection({ iceServers: [{ urls: STUN }] })
    pc = peer
    lastOfferSdp = offer.sdp || null
    peer.ondatachannel = (ev) => {
      if (ev.channel) bindDc(ev.channel)
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        try {
          peer.close()
        } catch {
          /* */
        }
        if (pc === peer) {
          pc = null
          activeDc = null
          linkOpen = false
          stopGameLinkEditBridge()
        }
      }
    }

    await peer.setRemoteDescription(offer)
    await peer.setLocalDescription(await peer.createAnswer())
    await waitIce(peer)
    if (!started || pc !== peer) return false
    const answer = normalizeLocalSdp(peer.localDescription!.toJSON() as Sdp)

    for (const base of bases) {
      try {
        const res = await chayaPostJson(`${base}/api/runtime/webrtc`, {
          action: 'answer',
          roomId: id,
          sdp: answer,
        })
        if (res.ok) {
          ChayaLog.ok('ChayaLink', `已应答 Web offer → ${base}`)
          return true
        }
      } catch {
        /* */
      }
    }
    return false
  } finally {
    answering = false
  }
}

function schedule(ms: number) {
  if (!started) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void loop()
  }, ms)
}

async function loop() {
  if (!started) return
  try {
    const before = gameRoomId()
    if (before === 'default') ensureLaunchEnvGlobals()
    const after = gameRoomId()
    if (before === 'default' && after !== 'default') {
      ChayaLog.info('ChayaLink', `已读到房间 id，开始协商（room=${after}, api=${resolveApiBase()}）`)
    }
    // When connected, only low-frequency probe whether Web has a new offer
    await tryAnswer()
  } catch (err) {
    ChayaLog.warn('ChayaLink', `协商失败: ${err instanceof Error ? err.message : String(err)}`)
    try {
      pc?.close()
    } catch {
      /* */
    }
    pc = null
    activeDc = null
    linkOpen = false
    stopGameLinkEditBridge()
  }
  schedule(linkOpen ? POLL_LINKED_MS : POLL_IDLE_MS)
}

/** Start game-side link (idempotent); wait for ChayaEnv room id to avoid default-room desync */
export function startGameLink() {
  if (started) return
  const host = globalThis as typeof globalThis & { __chayaStopGameLink?: () => void }
  host.__chayaStopGameLink?.()
  host.__chayaStopGameLink = stopGameLink
  started = true

  const boot = (attempt: number) => {
    if (!started) return
    if (!hasLaunchRoom()) ensureLaunchEnvGlobals()
    if (!hasLaunchRoom() && attempt < 120) {
      window.setTimeout(() => boot(attempt + 1), 250)
      return
    }
    const id = gameRoomId()
    if (id === 'default') {
      ChayaLog.warn('ChayaLink', '未读到 CHAYA_GAME_ID / LAUNCH_TOKEN，暂不进 default 房间（将持续重试 Env）')
    } else {
      ChayaLog.info('ChayaLink', `等待 Web 连接（room=${id}, api=${resolveApiBase()}）`)
    }
    void loop()
  }
  boot(0)
}

export function stopGameLink() {
  started = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  try {
    pc?.close()
  } catch {
    /* */
  }
  pc = null
  activeDc = null
  linkOpen = false
  lastOfferSdp = null
  stopGameLinkEditBridge()
}
