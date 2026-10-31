/**
 * 本机 WebRTC 信令板（内存）：Web 发 offer，游戏回 answer。
 * 整包 SDP（非 trickle），对齐工单 gather-complete 后再发。
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import os from 'node:os'

export type SignalingSdp = { type: RTCSdpType; sdp?: string }

export type SignalingRoom = {
  roomId: string
  offer: SignalingSdp | null
  answer: SignalingSdp | null
  /** Web 侧 DataChannel 已开（仅作辅助；权威在线以 Web DC 为准） */
  webConnected: boolean
  updatedAt: number
  /** Web 端创建 offer 时的来源 IP（如手机内网 IP） */
  clientIp?: string
}

type StoredRoom = SignalingRoom & {
  /** 浏览器模式：首个 Web 写入时绑定的连接令牌（SHA-256） */
  tokenHash?: Buffer
  /** 建房来源（客户端 IP），用于按来源限制房间数 */
  owner?: string
}

type Board = Map<string, StoredRoom>

/** ok：可访问；absent：房间不存在；forbidden：令牌不符；full：房间总数已满；limited：同一来源建房过多 */
export type RoomAccess = 'ok' | 'absent' | 'forbidden' | 'full' | 'limited'

const STORE_KEY = '__chaya_webrtc_signaling_v1__'
const ROOM_TTL_MS = 10 * 60_000
export const MAX_SIGNALING_ROOMS = 5_000
export const MAX_ROOMS_PER_OWNER = 20

export function detectLocalLanIp(): string | null {
  type Hit = { name: string; address: string }
  const hits: Hit[] = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === (4 as unknown as string)
      if (v4 && !a.internal) hits.push({ name, address: a.address })
    }
  }
  const score = (c: Hit) => {
    let s = 0
    if (/^en\d+$/i.test(c.name) || /^eth\d+$/i.test(c.name) || /^wlan/i.test(c.name) || /^wi-?fi/i.test(c.name)) s += 100
    if (/^192\.168\./.test(c.address)) s += 50
    else if (/^10\./.test(c.address)) s += 40
    else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(c.address)) s += 30
    if (/^(bridge|feth|veth|docker|vmnet|vbox|utun)/i.test(c.name)) s -= 80
    return s
  }
  hits.sort((a, b) => score(b) - score(a))
  return hits[0]?.address || null
}

/**
 * 修复 iOS Safari 在 HTTP 下生成的 mDNS .local 隐私候选，
 * 替换为真实探测到的客户端内网 IP，避免 NW.js 因 macOS Fake-IP / VPN 拦截无法建立点对点通道。
 */
export function patchOfferSdpWithLanIp(sdp: string, clientIp?: string): string {
  if (!clientIp || !sdp) return sdp
  let res = sdp.replace(
    /(candidate:[^\r\n]*\s(?:udp|tcp)\s+\d+\s+)(?:[a-zA-Z0-9.-]+\.local|0\.0\.0\.0)(\s+\d+\s+typ\s+host[^\r\n]*)/gi,
    `$1${clientIp}$2`
  )
  res = res.replace(/^c=IN IP4 (?:0\.0\.0\.0|127\.0\.0\.1)/gm, `c=IN IP4 ${clientIp}`)
  return res
}

/**
 * 针对局域网跨设备串流优化 Answer SDP：
 * 1. 首选 H.264 硬件解码载荷（iOS Safari 兼容性关键）；
 * 2. 剔除对远端手机不可达的 127.0.0.1 及 VPN 虚拟网卡候选（如 Surge utun）；
 * 3. 提权本机局域网物理网卡候选（如 192.168.31.89）并作为缺省连接地址。
 */
export function optimizeAnswerSdp(sdp: string, clientIp?: string, macLanIp = detectLocalLanIp() || undefined): string {
  if (!sdp) return sdp
  let lines = sdp.split(/\r?\n/)

  const isLanClient = clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1'
  if (isLanClient && macLanIp) {
    // 替换连接线地址为真实 Mac 局域网 IP
    lines = lines.map((line) => {
      if (/^c=IN IP4 (?:0\.0\.0\.0|127\.0\.0\.1|172\.28\.)/.test(line)) {
        return `c=IN IP4 ${macLanIp}`
      }
      return line
    })

    // 过滤对手机不可达的 host 候选
    lines = lines.filter((line) => {
      if (!line.startsWith('a=candidate:')) return true
      if (/ typ host/i.test(line)) {
        if (/ 127\.0\.0\.1 /i.test(line)) return false
        if (/ 172\.28\./i.test(line)) return false
        if (/ 192\.168\.64\./i.test(line)) return false
        if (/ 192\.168\.191\./i.test(line)) return false
      }
      return true
    })

    // 提权 Mac LAN 候选（赋予最高 host 优先级 2130706431 并排在候选首位）
    const lanCandidates: string[] = []
    const otherLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('a=candidate:') && line.includes(` ${macLanIp} `)) {
        const boosted = line.replace(/(candidate:\S+\s+\d+\s+udp\s+)\d+/, '$12130706431')
        lanCandidates.push(boosted)
      } else {
        otherLines.push(line)
      }
    }
    const firstCandIdx = otherLines.findIndex((l) => l.startsWith('a=candidate:'))
    if (firstCandIdx >= 0) {
      otherLines.splice(firstCandIdx, 0, ...lanCandidates)
      lines = otherLines
    } else {
      lines = [...otherLines, ...lanCandidates]
    }
  }

  // 首选 H.264 视频解码器（iOS Safari 硬件解码最稳定）
  let h264Pt: string | null = null
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+H264\/90000/i)
    if (match) {
      h264Pt = match[1]
      break
    }
  }
  if (h264Pt) {
    lines = lines.map((line) => {
      if (line.startsWith('m=video ')) {
        const parts = line.split(' ')
        if (parts.length > 3) {
          const pts = parts.slice(3).filter((pt) => pt !== h264Pt)
          return [...parts.slice(0, 3), h264Pt, ...pts].join(' ')
        }
      }
      return line
    })
  }

  return lines.join('\r\n')
}

function board(): Board {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: Board }
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map()
  return g[STORE_KEY]
}

function prune(now = Date.now()) {
  const b = board()
  for (const [id, room] of b) {
    if (now - room.updatedAt > ROOM_TTL_MS) b.delete(id)
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function publicRoom(room: StoredRoom): SignalingRoom {
  const { tokenHash: _hash, owner: _owner, ...rest } = room
  return { ...rest }
}

function lookup(roomId: string): StoredRoom | undefined {
  prune()
  return board().get(roomId)
}

function ensure(roomId: string): StoredRoom {
  const b = board()
  let room = lookup(roomId)
  if (!room) {
    room = { roomId, offer: null, answer: null, webConnected: false, updatedAt: Date.now() }
    b.set(roomId, room)
  }
  return room
}

/**
 * 浏览器模式的房间令牌校验。`claim`：房间不存在时由本次请求创建并绑定令牌（仅 Web 的 reset / offer）。
 * 已存在但未绑定令牌的房间（服务端模式遗留）在 claim 时补绑。
 */
export function checkRoomToken(roomId: string, token: string, opts: { claim: boolean; owner?: string }): RoomAccess {
  const hash = hashToken(token)
  const room = lookup(roomId)
  if (!room) {
    if (!opts.claim) return 'absent'
    if (opts.owner && [...board().values()].filter((r) => r.owner === opts.owner).length >= MAX_ROOMS_PER_OWNER) return 'limited'
    if (board().size >= MAX_SIGNALING_ROOMS) return 'full'
    const created = ensure(roomId)
    created.tokenHash = hash
    created.owner = opts.owner
    return 'ok'
  }
  if (!room.tokenHash) {
    if (!opts.claim) return 'forbidden'
    room.tokenHash = hash
    return 'ok'
  }
  return timingSafeEqual(room.tokenHash, hash) ? 'ok' : 'forbidden'
}

/** 只读，不创建房间 */
export function getSignalingRoom(roomId: string): SignalingRoom | null {
  const room = lookup(roomId)
  return room ? publicRoom(room) : null
}

/** 遍历当前所有活跃的信令房间 */
export function listAllSignalingRooms(): SignalingRoom[] {
  prune()
  return [...board().values()].map(publicRoom)
}

/** 服务端模式可直接建房；浏览器模式须先 `checkRoomToken(..., { claim: true })` */
export function publishOffer(roomId: string, offer: SignalingSdp, clientIp?: string): SignalingRoom {
  const room = ensure(roomId)
  const patchedSdp = clientIp && offer.sdp ? patchOfferSdpWithLanIp(offer.sdp, clientIp) : offer.sdp
  room.offer = { ...offer, sdp: patchedSdp }
  room.answer = null
  room.webConnected = false
  room.clientIp = clientIp
  room.updatedAt = Date.now()
  return publicRoom(room)
}

export function publishAnswer(roomId: string, answer: SignalingSdp): SignalingRoom | null {
  const room = lookup(roomId)
  if (!room) return null
  const optimizedSdp = answer.sdp ? optimizeAnswerSdp(answer.sdp, room.clientIp) : answer.sdp
  room.answer = { ...answer, sdp: optimizedSdp }
  room.updatedAt = Date.now()
  return publicRoom(room)
}

export function setWebConnected(roomId: string, connected: boolean): SignalingRoom | null {
  const room = lookup(roomId)
  if (!room) return null
  room.webConnected = connected
  room.updatedAt = Date.now()
  return publicRoom(room)
}

/** 清空协商状态；保留令牌绑定，避免 reset 与 offer 之间被他人抢先建房 */
export function resetSignalingRoom(roomId: string): void {
  const room = lookup(roomId)
  if (!room) return
  room.offer = null
  room.answer = null
  room.webConnected = false
  room.updatedAt = Date.now()
}

/** 测试用：清空整个信令板 */
export function clearSignalingBoard(): void {
  board().clear()
}

/** 是否有房间标记 Web 已连上（启动防重）；附带新鲜度，避免标签页崩溃后永久锁死 */
export function anyWebConnected(maxAgeMs = 30_000): boolean {
  prune()
  const now = Date.now()
  for (const room of board().values()) {
    if (room.webConnected && now - room.updatedAt <= maxAgeMs) return true
  }
  return false
}
