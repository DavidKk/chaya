/**
 * 本机 WebRTC 信令板（内存）：Web 发 offer，游戏回 answer。
 * 整包 SDP（非 trickle），对齐工单 gather-complete 后再发。
 */

export type SignalingSdp = { type: RTCSdpType; sdp?: string }

export type SignalingRoom = {
  roomId: string
  offer: SignalingSdp | null
  answer: SignalingSdp | null
  /** Web 侧 DataChannel 已开（仅作辅助；权威在线以 Web DC 为准） */
  webConnected: boolean
  updatedAt: number
}

type Board = Map<string, SignalingRoom>

const STORE_KEY = '__chaya_webrtc_signaling_v1__'
const ROOM_TTL_MS = 10 * 60_000

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

function ensure(roomId: string): SignalingRoom {
  prune()
  const id = String(roomId || '').trim() || 'default'
  const b = board()
  let room = b.get(id)
  if (!room) {
    room = { roomId: id, offer: null, answer: null, webConnected: false, updatedAt: Date.now() }
    b.set(id, room)
  }
  return room
}

export function getSignalingRoom(roomId: string): SignalingRoom {
  return { ...ensure(roomId) }
}

export function publishOffer(roomId: string, offer: SignalingSdp): SignalingRoom {
  const room = ensure(roomId)
  room.offer = offer
  room.answer = null
  room.webConnected = false
  room.updatedAt = Date.now()
  return { ...room }
}

export function publishAnswer(roomId: string, answer: SignalingSdp): SignalingRoom {
  const room = ensure(roomId)
  room.answer = answer
  room.updatedAt = Date.now()
  return { ...room }
}

export function setWebConnected(roomId: string, connected: boolean): SignalingRoom {
  const room = ensure(roomId)
  room.webConnected = connected
  room.updatedAt = Date.now()
  return { ...room }
}

export function resetSignalingRoom(roomId: string): void {
  board().delete(String(roomId || '').trim() || 'default')
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
