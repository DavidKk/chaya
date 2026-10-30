import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import type { BergamotFile } from '@/lib/translate/bergamot'
import { measureOperation } from '@/services/log/operation'

export async function hashFile(file: string): Promise<string> {
  return measureOperation(
    'translate',
    'bergamot.pack.hash',
    { file: path.basename(file) },
    async () => {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      return hash.digest('hex')
    },
    { start: false }
  )
}

/** Manifest URLs only. No redirects or HTTP content decoding; digests cover stored gzip bytes. */
export async function downloadPackFile(file: BergamotFile, destination: string, signal: AbortSignal, progress: (bytes: number) => void) {
  return measureOperation('translate', 'bergamot.pack.download', { file: file.name, bytes: file.bytes }, () => downloadFile(file, destination, signal, progress))
}

async function downloadFile(file: BergamotFile, destination: string, signal: AbortSignal, progress: (bytes: number) => void) {
  const url = new URL(file.url)
  if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || !url.pathname.startsWith('/moz-fx-translations-data--303e-prod-translations-data/models/'))
    throw new Error('PACK_INVALID_RESOURCE')
  const stop = new AbortController()
  const downloadSignal = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(10 * 60_000)])
  const handle = await open(destination, 'wx', 0o600)
  const ranges = file.bytes > 4 * 1024 * 1024
  const chunkSize = ranges ? 1024 * 1024 : file.bytes
  let next = 0
  const work = async () => {
    while (next < file.bytes) {
      const start = next
      next += chunkSize
      const end = Math.min(start + chunkSize, file.bytes) - 1
      const response = await fetch(url, {
        redirect: 'error',
        headers: { 'Accept-Encoding': 'identity', ...(ranges ? { Range: `bytes=${start}-${end}` } : {}) },
        signal: downloadSignal,
      })
      if (
        !response.body ||
        response.status !== (ranges ? 206 : 200) ||
        !['identity', null].includes(response.headers.get('content-encoding')) ||
        (ranges && response.headers.get('content-range') !== `bytes ${start}-${end}/${file.bytes}`)
      ) {
        await response.body?.cancel()
        throw new Error('PACK_DOWNLOAD_FAILED')
      }
      let position = start
      for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)) {
        downloadSignal.throwIfAborted()
        if (position + chunk.length > end + 1) throw new Error('PACK_DOWNLOAD_FAILED')
        let offset = 0
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, position + offset)
          if (!bytesWritten) throw new Error('PACK_DOWNLOAD_FAILED')
          offset += bytesWritten
        }
        position += chunk.length
        progress(chunk.length)
      }
      if (position !== end + 1) throw new Error('PACK_DOWNLOAD_FAILED')
    }
  }
  // All workers settle before closing the shared file, including cancellation or a failed range.
  const results = await Promise.allSettled(
    Array.from({ length: ranges ? 4 : 1 }, () =>
      work().catch((error) => {
        stop.abort()
        throw error
      })
    )
  )
  try {
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    await handle.sync()
  } finally {
    await handle.close()
  }
  if ((await hashFile(destination)) !== file.sha256) throw new Error('PACK_CHECKSUM_FAILED')
}

export async function unpackFile(file: BergamotFile, source: string, destination: string, signal: AbortSignal) {
  return measureOperation('translate', 'bergamot.pack.unpack', { file: file.name, bytes: file.bytes, unpackedBytes: file.unpackedBytes }, () =>
    unpack(file, source, destination, signal)
  )
}

async function unpack(file: BergamotFile, source: string, destination: string, signal: AbortSignal) {
  let size = 0
  const hash = createHash('sha256')
  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > file.unpackedBytes) return callback(new Error('PACK_CHECKSUM_FAILED'))
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(createReadStream(source), createGunzip(), guard, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal })
  if (size !== file.unpackedBytes || hash.digest('hex') !== file.unpackedSha256) throw new Error('PACK_CHECKSUM_FAILED')
}
