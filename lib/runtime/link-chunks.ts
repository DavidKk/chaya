/** 大消息分片：把一条完整的 link 消息拆成多个 `link.chunk`，接收端重组后按原消息分发。 */

export type LinkChunkPacket = { type: 'link.chunk'; id: string; index: number; total: number; chunk: string }

const CHUNK = 4_096 // 即使全是汉字，单条 DataChannel 消息也小于 16 KiB。
const MAX_CHARS = 32 * 1024 * 1024
const TIMEOUT = 60_000
const MAX_PENDING = 8

let sequence = 0
const prefix = Math.random().toString(36).slice(2)

/** 每 8 片让出一次事件循环，避免一次塞满通道缓冲区 */
export async function sendChunked(send: (packet: LinkChunkPacket) => void | Promise<void>, message: unknown): Promise<void> {
  const raw = JSON.stringify(message)
  if (raw.length > MAX_CHARS) throw new Error('数据过大，无法通过游戏连接发送')
  const id = `${prefix}-${++sequence}`
  const total = Math.max(1, Math.ceil(raw.length / CHUNK))
  for (let index = 0; index < total; index++) {
    await send({ type: 'link.chunk', id, index, total, chunk: raw.slice(index * CHUNK, (index + 1) * CHUNK) })
    if (index % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

type Parts = { chunks: string[]; total: number; size: number; timer: ReturnType<typeof setTimeout> }

export function createChunkReceiver(onMessage: (message: unknown) => void) {
  const incoming = new Map<string, Parts>()

  function receive(packet: LinkChunkPacket) {
    const { id, index, total, chunk } = packet
    if (typeof id !== 'string' || id.length > 100) return
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total || total > MAX_CHARS / CHUNK || typeof chunk !== 'string' || chunk.length > CHUNK)
      return
    let parts = incoming.get(id)
    if (!parts) {
      if (index !== 0 || incoming.size >= MAX_PENDING) return
      parts = { chunks: [], total, size: 0, timer: setTimeout(() => incoming.delete(id), TIMEOUT) }
      incoming.set(id, parts)
    }
    if (total !== parts.total || index !== parts.chunks.length) {
      clearTimeout(parts.timer)
      incoming.delete(id)
      return
    }
    parts.chunks.push(chunk)
    parts.size += chunk.length
    if (parts.chunks.length !== total) return
    clearTimeout(parts.timer)
    incoming.delete(id)
    let message: unknown
    try {
      message = JSON.parse(parts.chunks.join(''))
    } catch {
      return
    }
    if (message && typeof message === 'object' && 'type' in message) onMessage(message)
  }

  function dispose() {
    for (const parts of incoming.values()) clearTimeout(parts.timer)
    incoming.clear()
  }

  return { receive, dispose }
}
