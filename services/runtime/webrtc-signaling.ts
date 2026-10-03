/**
 * 本机 WebRTC 信令板（内存）：Web 发 offer，游戏回 answer。
 * 整包 SDP（非 trickle），对齐工单 gather-complete 后再发。
 */

import { createHash, timingSafeEqual } from 'node:crypto'

export type SignalingSdp = { type: RTCSdpType; sdp?: string }

export type SignalingRoom = {
  roomId: string
  offer: SignalingSdp | null
  answer: SignalingSdp | null
  /** Web 侧 DataChannel 已开（仅作辅助；权威在线以 Web DC 为准） */
  webConnected: boolean
  updatedAt: number
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

/** 服务端模式可直接建房；浏览器模式须先 `checkRoomToken(..., { claim: true })` */
export function publishOffer(roomId: string, offer: SignalingSdp): SignalingRoom {
  const room = ensure(roomId)
  room.offer = offer
  room.answer = null
  room.webConnected = false
  room.updatedAt = Date.now()
  return publicRoom(room)
}

export function publishAnswer(roomId: string, answer: SignalingSdp): SignalingRoom | null {
  const room = lookup(roomId)
  if (!room) return null
  room.answer = answer
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
