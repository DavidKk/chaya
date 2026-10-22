import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { gzipSync } from 'node:zlib'

import type { BergamotFile } from '@/lib/translate/bergamot'
import { downloadPackFile, unpackFile } from '@/services/translate/bergamot/download'

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const model = Buffer.from('real model payload')
const gzip = gzipSync(model)
const file: BergamotFile = {
  name: 'model.bin',
  url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/test.gz',
  bytes: gzip.length,
  sha256: hash(gzip),
  unpackedBytes: model.length,
  unpackedSha256: hash(model),
}
let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-download-test-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  jest.restoreAllMocks()
})
function response(payload: Buffer, status = 200) {
  return {
    status,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(payload)
        controller.close()
      },
    }),
  } as unknown as Response
}
it('verifies transport bytes, reports actual progress, and verifies decompressed content', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(gzip))
  const progress = jest.fn()
  const archive = path.join(root, 'pack.gz')
  await downloadPackFile(file, archive, new AbortController().signal, progress)
  expect(progress.mock.calls.reduce((sum, [bytes]) => sum + bytes, 0)).toBe(gzip.length)
  const output = path.join(root, 'model.bin')
  await unpackFile(file, archive, output, new AbortController().signal)
  expect(fs.readFileSync(output)).toEqual(model)
})
it('rejects corrupt downloads and decompression expansion beyond the pinned size', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(Buffer.alloc(gzip.length)))
  await expect(downloadPackFile(file, path.join(root, 'bad.gz'), new AbortController().signal, () => {})).rejects.toThrow('PACK_CHECKSUM_FAILED')
  fs.writeFileSync(path.join(root, 'valid.gz'), gzip)
  await expect(unpackFile({ ...file, unpackedBytes: 1 }, path.join(root, 'valid.gz'), path.join(root, 'bad.bin'), new AbortController().signal)).rejects.toThrow(
    'PACK_CHECKSUM_FAILED'
  )
})
it('never downloads arbitrary URLs and rejects non-success responses', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(gzip, 403))
  await expect(downloadPackFile({ ...file, url: 'https://example.org/model' }, path.join(root, 'other'), new AbortController().signal, () => {})).rejects.toThrow(
    'PACK_INVALID_RESOURCE'
  )
  expect(fetch).not.toHaveBeenCalled()
  await expect(downloadPackFile(file, path.join(root, 'denied'), new AbortController().signal, () => {})).rejects.toThrow('PACK_DOWNLOAD_FAILED')
})
it('rejects range responses that do not match the requested byte range', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(gzip, 206))
  await expect(downloadPackFile({ ...file, bytes: 5 * 1024 * 1024 }, path.join(root, 'range'), new AbortController().signal, () => {})).rejects.toThrow('PACK_DOWNLOAD_FAILED')
})
