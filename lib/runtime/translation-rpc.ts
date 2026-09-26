import type { TranslationRequest, TranslationRequestFn, TranslationResponse } from '@/lib/translate/runtime-api'

export type TranslationPacket =
  { type: 'translation.rpc'; id: string; kind: 'cancel' } | { type: 'translation.rpc'; id: string; kind: 'request' | 'response'; index: number; total: number; chunk: string }

const CHUNK = 4_096 // 即使全是汉字，单条 DataChannel 消息也小于 16 KiB。
const MAX_CHARS = 32 * 1024 * 1024
const TIMEOUT = 60_000
type Parts = { chunks: string[]; total: number; size: number; timer: ReturnType<typeof setTimeout> }

/** 有界分片、请求关联、取消和断线清理。两端复用，插件之间无需共享模块闭包。 */
export function createTranslationRpc(send: (packet: TranslationPacket) => void | Promise<void>, handle?: TranslationRequestFn) {
  let disposed = false
  let sequence = 0
  const prefix = Math.random().toString(36).slice(2)
  const pending = new Map<string, { resolve: (value: TranslationResponse) => void; reject: (error: Error) => void }>()
  const running = new Map<string, AbortController>()
  const incoming = new Map<string, Parts>()

  async function transmit(id: string, kind: 'request' | 'response', value: unknown, signal?: AbortSignal) {
    const raw = JSON.stringify(value)
    if (raw.length > MAX_CHARS) throw new Error('翻译数据过大，请分批导入')
    const total = Math.ceil(raw.length / CHUNK)
    for (let index = 0; index < total; index++) {
      if (disposed || signal?.aborted) throw new Error('游戏连接已断开或请求已取消')
      await send({ type: 'translation.rpc', id, kind, index, total, chunk: raw.slice(index * CHUNK, (index + 1) * CHUNK) })
      if (index % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  const request: TranslationRequestFn = (input, signal) =>
    new Promise((resolve, reject) => {
      if (disposed || signal?.aborted) return reject(new Error('游戏连接已断开或请求已取消'))
      if (pending.size >= 32) return reject(new Error('翻译请求过多，请稍后重试'))
      const id = `${prefix}-${++sequence}`
      const finish = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        pending.delete(id)
      }
      const cancel = () => {
        finish()
        try {
          void Promise.resolve(send({ type: 'translation.rpc', id, kind: 'cancel' })).catch(() => {})
        } catch {
          /* 已断线 */
        }
        reject(new Error('翻译请求已取消或超时，请确认游戏插件已更新'))
      }
      const timer = setTimeout(cancel, TIMEOUT)
      pending.set(id, {
        resolve: (value) => {
          finish()
          resolve(value)
        },
        reject: (error) => {
          finish()
          reject(error)
        },
      })
      signal?.addEventListener('abort', cancel, { once: true })
      void transmit(id, 'request', input, signal).catch((error) => pending.get(id)?.reject(error))
    })

  function receive(packet: TranslationPacket) {
    if (disposed || typeof packet.id !== 'string' || packet.id.length > 100) return
    if (packet.kind === 'cancel') {
      running.get(packet.id)?.abort()
      const partial = incoming.get(`request:${packet.id}`)
      if (partial) clearTimeout(partial.timer)
      incoming.delete(`request:${packet.id}`)
      return
    }
    if (packet.kind !== 'request' && packet.kind !== 'response') return
    if (packet.kind === 'response' && !pending.has(packet.id)) return
    if (packet.kind === 'request' && (!handle || running.has(packet.id))) return
    const { index, total, chunk } = packet
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total || total > MAX_CHARS / CHUNK || typeof chunk !== 'string' || chunk.length > CHUNK)
      return
    const key = `${packet.kind}:${packet.id}`
    let parts = incoming.get(key)
    if (!parts) {
      if (index !== 0 || incoming.size >= 8) return
      parts = { chunks: [], total, size: 0, timer: setTimeout(() => incoming.delete(key), TIMEOUT) }
      incoming.set(key, parts)
    }
    if (total !== parts.total || index !== parts.chunks.length) return
    parts.chunks.push(chunk)
    parts.size += chunk.length
    if (parts.size > MAX_CHARS || parts.chunks.length !== total) return
    clearTimeout(parts.timer)
    incoming.delete(key)
    let value: unknown
    try {
      value = JSON.parse(parts.chunks.join(''))
    } catch {
      return
    }
    if (packet.kind === 'response') {
      pending.get(packet.id)?.resolve(value as TranslationResponse)
      return
    }
    if (running.size >= 16) return
    const abort = new AbortController()
    running.set(packet.id, abort)
    void (async () => {
      try {
        let result: TranslationResponse
        try {
          result = await handle!(value as TranslationRequest, abort.signal)
        } catch (error) {
          result = { status: 500, data: { ok: false, error: { message: error instanceof Error ? error.message : '翻译操作失败' } } }
        }
        await transmit(packet.id, 'response', result, abort.signal)
      } catch {
        /* 请求已取消或通道已关闭 */
      } finally {
        running.delete(packet.id)
      }
    })()
  }

  function dispose() {
    disposed = true
    for (const item of pending.values()) item.reject(new Error('游戏连接已断开'))
    for (const abort of running.values()) abort.abort()
    for (const parts of incoming.values()) clearTimeout(parts.timer)
    incoming.clear()
    running.clear()
  }
  return { request, receive, dispose }
}

/** 对大词库导入/导出施加背压，避免把整个文件一次塞进通道缓冲区。 */
export async function sendTranslationPacket(channel: RTCDataChannel | null, packet: TranslationPacket) {
  if (!channel || channel.readyState !== 'open') throw new Error('游戏连接已断开')
  const started = Date.now()
  while (channel.bufferedAmount > 256 * 1024) {
    if (channel.readyState !== 'open' || Date.now() - started > 10_000) throw new Error('游戏连接繁忙，请稍后重试')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (channel.readyState !== 'open') throw new Error('游戏连接已断开')
  channel.send(JSON.stringify(packet))
}
