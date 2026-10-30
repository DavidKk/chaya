import { requestPath, startClientOperation, type TimingReporter } from '@/lib/log/timing'
import type { TranslationRequest, TranslationRequestFn, TranslationResponse } from '@/lib/translate/runtime-api'

export type TranslationPacket =
  { type: 'translation.rpc'; id: string; kind: 'cancel' } | { type: 'translation.rpc'; id: string; kind: 'request' | 'response'; index: number; total: number; chunk: string }

const CHUNK = 4_096 // 即使全是汉字，单条 DataChannel 消息也小于 16 KiB。
const MAX_CHARS = 32 * 1024 * 1024
const TIMEOUT = 60_000
type Parts = { chunks: string[]; total: number; size: number; timer: ReturnType<typeof setTimeout>; timing: ReturnType<typeof startClientOperation> }

/** 有界分片、请求关联、取消和断线清理。两端复用，插件之间无需共享模块闭包。 */
export function createTranslationRpc(send: (packet: TranslationPacket) => void | Promise<void>, handle?: TranslationRequestFn, report?: TimingReporter) {
  let disposed = false
  let sequence = 0
  const prefix = Math.random().toString(36).slice(2)
  const pending = new Map<string, { resolve: (value: TranslationResponse) => void; reject: (error: Error) => void }>()
  const running = new Map<string, AbortController>()
  const incoming = new Map<string, Parts>()

  async function transmit(id: string, kind: 'request' | 'response', value: unknown, signal?: AbortSignal) {
    const timing = startClientOperation(report, 'translation.rpc.send', { kind }, id)
    let chunksSent = 0
    let chars = 0
    try {
      const raw = JSON.stringify(value)
      chars = raw.length
      const encodeMs = timing.elapsedMs()
      if (raw.length > MAX_CHARS) throw new Error('Translation payload too large, please import in batches')
      const total = Math.ceil(raw.length / CHUNK)
      for (let index = 0; index < total; index++) {
        if (disposed || signal?.aborted) throw new Error('Game connection disconnected or request cancelled')
        await send({ type: 'translation.rpc', id, kind, index, total, chunk: raw.slice(index * CHUNK, (index + 1) * CHUNK) })
        chunksSent++
        if (index % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0))
      }
      timing.end('completed', { chars, chunks: total, encodeMs, sendMs: Math.round((timing.elapsedMs() - encodeMs) * 10) / 10 })
    } catch (error) {
      timing.end(disposed || signal?.aborted ? 'cancelled' : 'failed', { chars, chunksSent })
      throw error
    }
  }

  const request: TranslationRequestFn = (input, signal) =>
    new Promise((resolve, reject) => {
      if (disposed || signal?.aborted) return reject(new Error('Game connection disconnected or request cancelled'))
      if (pending.size >= 32) return reject(new Error('翻译请求过多，请稍后重试'))
      const id = `${prefix}-${++sequence}`
      const timing = startClientOperation(report, 'translation.rpc.roundtrip', { method: input.method, path: requestPath(input.path), pending: pending.size }, id)
      const finish = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        pending.delete(id)
      }
      const cancel = () => {
        timing.end(signal?.aborted ? 'cancelled' : 'failed', { reason: signal?.aborted ? 'aborted' : 'timeout' })
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
          timing.end(value.status >= 400 ? 'failed' : 'completed', { status: value.status })
          finish()
          resolve(value)
        },
        reject: (error) => {
          timing.end(disposed || signal?.aborted ? 'cancelled' : 'failed', { errorName: error.name })
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
      if (partial) {
        clearTimeout(partial.timer)
        partial.timing.end('cancelled', { chars: partial.size, chunks: partial.chunks.length })
      }
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
      const timing = startClientOperation(report, 'translation.rpc.receive', { kind: packet.kind, chunks: total }, packet.id)
      parts = {
        chunks: [],
        total,
        size: 0,
        timing,
        timer: setTimeout(() => {
          const partial = incoming.get(key)
          timing.end('failed', { reason: 'reassembly-timeout', chars: partial?.size, chunksReceived: partial?.chunks.length })
          incoming.delete(key)
        }, TIMEOUT),
      }
      incoming.set(key, parts)
    }
    if (total !== parts.total || index !== parts.chunks.length) return
    parts.chunks.push(chunk)
    parts.size += chunk.length
    if (parts.size > MAX_CHARS || parts.chunks.length !== total) return
    clearTimeout(parts.timer)
    incoming.delete(key)
    let value: unknown
    const parsing = performance.now()
    try {
      value = JSON.parse(parts.chunks.join(''))
    } catch {
      parts.timing.end('failed', { reason: 'invalid-json', chars: parts.size })
      return
    }
    parts.timing.end('completed', { chars: parts.size, decodeMs: Math.round((performance.now() - parsing) * 10) / 10 })
    if (packet.kind === 'response') {
      pending.get(packet.id)?.resolve(value as TranslationResponse)
      return
    }
    if (running.size >= 16) return
    const abort = new AbortController()
    running.set(packet.id, abort)
    void (async () => {
      const request = value as TranslationRequest | null
      const timing = startClientOperation(
        report,
        'translation.rpc.handle',
        { method: request?.method, path: requestPath(typeof request?.path === 'string' ? request.path : '') },
        packet.id
      )
      try {
        let result: TranslationResponse
        try {
          result = await handle!({ ...(value as TranslationRequest), requestId: packet.id }, abort.signal)
        } catch (error) {
          result = { status: 500, data: { ok: false, error: { message: error instanceof Error ? error.message : '翻译操作失败' } } }
        }
        const executeMs = timing.elapsedMs()
        timing.mark('response-ready', { status: result.status, executeMs })
        await transmit(packet.id, 'response', result, abort.signal)
        timing.end(result.status >= 400 ? 'failed' : 'completed', { status: result.status, executeMs, responseSendMs: Math.round((timing.elapsedMs() - executeMs) * 10) / 10 })
      } catch {
        timing.end(disposed || abort.signal.aborted ? 'cancelled' : 'failed', { phase: 'response-send' })
        /* 请求已取消或通道已关闭 */
      } finally {
        running.delete(packet.id)
      }
    })()
  }

  function dispose() {
    disposed = true
    for (const item of pending.values()) item.reject(new Error('Game connection disconnected'))
    for (const abort of running.values()) abort.abort()
    for (const parts of incoming.values()) {
      clearTimeout(parts.timer)
      parts.timing.end('cancelled', { reason: 'disconnected', chars: parts.size, chunksReceived: parts.chunks.length })
    }
    incoming.clear()
    running.clear()
  }
  return { request, receive, dispose }
}

/** 对大词库导入/导出施加背压，避免把整个文件一次塞进通道缓冲区。 */
export async function sendTranslationPacket(channel: RTCDataChannel | null, packet: TranslationPacket) {
  if (!channel || channel.readyState !== 'open') throw new Error('Game connection disconnected')
  const started = Date.now()
  while (channel.bufferedAmount > 256 * 1024) {
    if (channel.readyState !== 'open' || Date.now() - started > 10_000) throw new Error('Game connection busy, please try again later')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (channel.readyState !== 'open') throw new Error('Game connection disconnected')
  channel.send(JSON.stringify(packet))
}
