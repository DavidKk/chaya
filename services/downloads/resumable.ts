/**
 * 可续传下载（对齐 bash 的 `.part` + `curl --continue-at -`）：
 * 已有 `<dest>.part` 时带 Range 续传；源站不支持 Range（200）则从头下；失败 / 超时 / 取消都保留 `.part`。
 * 只有校验不符，或 206 / 416 证明本地部分与源端区间不相容时删除 `.part`（后者从头重试一次）。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** 连续这么久收不到数据即判定下载卡死 */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000

export type DownloadByteProgress = { receivedBytes: number; totalBytes?: number; resumedFrom: number }

export type ResumableDownloadOpts = {
  signal?: AbortSignal
  onBytes?: (p: DownloadByteProgress) => void
  idleTimeoutMs?: number
  /** 期望的 SHA-256（hex）；不符时删除 `.part` 并报错 */
  sha256?: string
  /** 错误文案里的名称 */
  label?: string
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

export async function sha256File(p: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(p), hash, { signal })
  return hash.digest('hex')
}

/** `bytes start-end/total`；格式不对返回 null */
export function parseContentRange(header: string | null): { start: number; end: number; total: number } | null {
  const m = header?.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  if (!m) return null
  return { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) }
}

/** 416 的 `bytes *\/total` */
function parseUnsatisfiedTotal(header: string | null): number | undefined {
  const m = header?.trim().match(/^bytes\s+\*\/(\d+)$/i)
  return m ? Number(m[1]) : undefined
}

function lengthFromHeaders(res: Response): number | undefined {
  const encoding = res.headers.get('content-encoding')
  if (encoding && encoding !== 'identity') return undefined
  const n = Number(res.headers.get('content-length'))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

async function verifyOrDiscard(tmp: string, opts: ResumableDownloadOpts, label: string): Promise<void> {
  if (!opts.sha256) return
  const actual = await sha256File(tmp, opts.signal)
  if (actual.toLowerCase() !== opts.sha256.toLowerCase()) {
    fs.rmSync(tmp, { force: true })
    throw new Error(`${label} 校验失败（SHA-256 不符），已删除已下载部分，请重试`)
  }
}

class RangeMismatch extends Error {}

export async function downloadToFile(url: string, dest: string, opts: ResumableDownloadOpts = {}): Promise<{ resumedFrom: number }> {
  const label = opts.label ?? path.basename(dest)
  const idleMs = opts.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS
  const tmp = `${dest}.part`
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  const ctl = new AbortController()
  const onOuterAbort = () => ctl.abort(opts.signal?.reason ?? new Error('已取消'))
  if (opts.signal?.aborted) onOuterAbort()
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  let idle: ReturnType<typeof setTimeout> | undefined
  const armIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(() => ctl.abort(new Error(`下载 ${label} 超时：${Math.round(idleMs / 1000)} 秒未收到数据，重试会接着下载`)), idleMs)
  }

  /** 返回 `.part` 的期望总长（未知为 undefined）与续传起点 */
  const fetchToPart = async (): Promise<{ total?: number; resumedFrom: number }> => {
    const existing = fileSize(tmp)
    armIdle()
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: existing > 0 ? { Range: `bytes=${existing}-` } : undefined })

    if (res.status === 416 && existing > 0) {
      await res.body?.cancel()
      const total = parseUnsatisfiedTotal(res.headers.get('content-range'))
      if (total !== existing) throw new RangeMismatch()
      opts.onBytes?.({ receivedBytes: existing, totalBytes: total, resumedFrom: existing })
      return { total, resumedFrom: existing }
    }
    if (res.status === 206) {
      const range = parseContentRange(res.headers.get('content-range'))
      if (!range || range.start !== existing || range.end < range.start || range.total <= range.end) {
        await res.body?.cancel()
        throw new RangeMismatch()
      }
    } else if (res.status !== 200) {
      await res.body?.cancel()
      throw new Error(`下载 ${label} 失败 HTTP ${res.status}: ${url}`)
    }
    if (!res.body) throw new Error(`下载 ${label} 失败：响应没有内容`)

    const append = res.status === 206 && existing > 0
    const resumedFrom = append ? existing : 0
    const total = res.status === 206 ? parseContentRange(res.headers.get('content-range'))?.total : lengthFromHeaders(res)
    let received = resumedFrom
    opts.onBytes?.({ receivedBytes: received, totalBytes: total, resumedFrom })
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        armIdle()
        opts.onBytes?.({ receivedBytes: received, totalBytes: total, resumedFrom })
        cb(null, chunk)
      },
    })
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
    await pipeline(body, counter, fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' }), { signal: ctl.signal })
    return { total, resumedFrom }
  }

  try {
    let got: { total?: number; resumedFrom: number }
    try {
      got = await fetchToPart()
    } catch (e) {
      if (!(e instanceof RangeMismatch)) throw e
      fs.rmSync(tmp, { force: true })
      try {
        got = await fetchToPart()
      } catch (e2) {
        if (e2 instanceof RangeMismatch) throw new Error(`下载 ${label} 失败：源站返回的字节区间不合法`)
        throw e2
      }
    }
    clearTimeout(idle)

    const size = fileSize(tmp)
    if (got.total != null && size !== got.total) {
      throw new Error(`下载 ${label} 不完整（${size}/${got.total} 字节），重试会接着下载`)
    }
    await verifyOrDiscard(tmp, opts, label)
    fs.renameSync(tmp, dest)
    return { resumedFrom: got.resumedFrom }
  } catch (e) {
    const reason: unknown = ctl.signal.aborted ? ctl.signal.reason : undefined
    throw reason instanceof Error ? reason : e
  } finally {
    clearTimeout(idle)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}
