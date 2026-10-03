import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { downloadToFile, parseContentRange } from '@/services/downloads/resumable'

const BODY = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'.repeat(4))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void

let server: http.Server
let base = ''
let handler: Handler = () => {}
let requests: Array<string | undefined> = []
let dir = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.headers.range)
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.zip`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  requests = []
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-resumable-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** 按 Range 正确返回 206 的源站 */
const rangeServer: Handler = (req, res) => {
  const m = req.headers.range?.match(/bytes=(\d+)-/)
  if (!m) {
    res.writeHead(200, { 'Content-Length': BODY.length })
    res.end(BODY)
    return
  }
  const start = Number(m[1])
  if (start >= BODY.length) {
    res.writeHead(416, { 'Content-Range': `bytes */${BODY.length}` })
    res.end()
    return
  }
  res.writeHead(206, { 'Content-Range': `bytes ${start}-${BODY.length - 1}/${BODY.length}`, 'Content-Length': BODY.length - start })
  res.end(BODY.subarray(start))
}

const dest = () => path.join(dir, 'file.zip')
const part = () => `${dest()}.part`

test('parseContentRange', () => {
  expect(parseContentRange('bytes 100-199/215951728')).toEqual({ start: 100, end: 199, total: 215951728 })
  expect(parseContentRange('bytes */100')).toBeNull()
  expect(parseContentRange(null)).toBeNull()
})

test('206 续传追加到已有 .part', async () => {
  handler = rangeServer
  fs.writeFileSync(part(), BODY.subarray(0, 50))
  const seen: number[] = []
  const r = await downloadToFile(base, dest(), { sha256: sha(BODY), onBytes: (p) => seen.push(p.receivedBytes) })
  expect(r.resumedFrom).toBe(50)
  expect(requests).toEqual(['bytes=50-'])
  expect(fs.readFileSync(dest())).toEqual(BODY)
  expect(fs.existsSync(part())).toBe(false)
  expect(seen[0]).toBe(50)
})

test.each([
  ['缺失', undefined],
  ['起点不符', `bytes 0-${BODY.length - 1}/${BODY.length}`],
  ['总长非法', `bytes 50-${BODY.length - 1}/${BODY.length - 1}`],
])('206 Content-Range %s：删除 .part 后不带 Range 从头下', async (_name, contentRange) => {
  handler = (req, res) => {
    if (req.headers.range) {
      res.writeHead(206, contentRange ? { 'Content-Range': contentRange } : {})
      res.end(BODY.subarray(50))
      return
    }
    rangeServer(req, res)
  }
  fs.writeFileSync(part(), Buffer.from('x'.repeat(50)))
  const r = await downloadToFile(base, dest())
  expect(r.resumedFrom).toBe(0)
  expect(requests).toEqual(['bytes=50-', undefined])
  expect(fs.readFileSync(dest())).toEqual(BODY)
})

test('206 起点 0 且未带 Range 时接受', async () => {
  handler = (_req, res) => {
    res.writeHead(206, { 'Content-Range': `bytes 0-${BODY.length - 1}/${BODY.length}` })
    res.end(BODY)
  }
  await downloadToFile(base, dest())
  expect(fs.readFileSync(dest())).toEqual(BODY)
})

test('从头重试仍返回非法区间时报错，不循环', async () => {
  handler = (_req, res) => {
    res.writeHead(206, { 'Content-Range': 'bytes 7-9/100' })
    res.end('abc')
  }
  fs.writeFileSync(part(), Buffer.from('x'.repeat(10)))
  await expect(downloadToFile(base, dest())).rejects.toThrow(/区间不合法/)
  expect(requests).toHaveLength(2)
})

test('200 忽略 Range 时覆盖 .part 从头写', async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'Content-Length': BODY.length })
    res.end(BODY)
  }
  fs.writeFileSync(part(), Buffer.from('garbage'))
  const r = await downloadToFile(base, dest())
  expect(r.resumedFrom).toBe(0)
  expect(fs.readFileSync(dest())).toEqual(BODY)
})

test('416 且总长等于 .part：视为已完整', async () => {
  handler = rangeServer
  fs.writeFileSync(part(), BODY)
  await downloadToFile(base, dest(), { sha256: sha(BODY) })
  expect(requests).toEqual([`bytes=${BODY.length}-`])
  expect(fs.readFileSync(dest())).toEqual(BODY)
})

test.each([
  ['总长缺失', {}],
  ['总长不符', { 'Content-Range': `bytes */${BODY.length + 5}` }],
])('416 %s：删除 .part 从头下', async (_name, headers) => {
  handler = (req, res) => {
    if (req.headers.range) {
      res.writeHead(416, headers)
      res.end()
      return
    }
    rangeServer(req, res)
  }
  fs.writeFileSync(part(), Buffer.from('x'.repeat(BODY.length)))
  await downloadToFile(base, dest())
  expect(requests).toEqual([`bytes=${BODY.length}-`, undefined])
  expect(fs.readFileSync(dest())).toEqual(BODY)
})

test('字节不足：报错并保留 .part', async () => {
  handler = (_req, res) => {
    res.writeHead(206, { 'Content-Range': `bytes 0-${BODY.length - 1}/${BODY.length + 10}` })
    res.end(BODY)
  }
  await expect(downloadToFile(base, dest())).rejects.toThrow(/不完整/)
  expect(fs.statSync(part()).size).toBe(BODY.length)
})

test('SHA-256 不符：删除 .part', async () => {
  handler = rangeServer
  await expect(downloadToFile(base, dest(), { sha256: '0'.repeat(64) })).rejects.toThrow(/校验失败/)
  expect(fs.existsSync(part())).toBe(false)
  expect(fs.existsSync(dest())).toBe(false)
})

test('空闲超时：报错并保留 .part', async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'Content-Length': BODY.length })
    res.write(BODY.subarray(0, 20))
  }
  await expect(downloadToFile(base, dest(), { idleTimeoutMs: 200 })).rejects.toThrow(/秒未收到数据/)
  expect(fs.statSync(part()).size).toBe(20)
})

test('取消：抛出取消原因并保留 .part', async () => {
  const abort = new AbortController()
  handler = (_req, res) => {
    res.writeHead(200, { 'Content-Length': BODY.length })
    res.write(BODY.subarray(0, 20), () => setTimeout(() => abort.abort(new Error('已取消')), 50))
  }
  await expect(downloadToFile(base, dest(), { signal: abort.signal })).rejects.toThrow('已取消')
  expect(fs.existsSync(part())).toBe(true)
})
