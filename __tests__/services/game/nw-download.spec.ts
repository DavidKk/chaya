import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { nwArchiveName, nwFileKey } from '@/lib/game/nw-download-meta'
import { ensureLatestNwShellSource, fetchNwSha256, parseShaSums, pruneShellCacheParts } from '@/services/game/nw-download'

const VERSION = 'v0.1.0'
const fileKey = nwFileKey(process.platform, process.arch)
const archiveName = nwArchiveName(VERSION, fileKey)
const CORRUPT = Buffer.from('definitely not an archive')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

const realFetch = global.fetch
let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-nwdl-'))
})

afterEach(() => {
  global.fetch = realFetch
  fs.rmSync(dir, { recursive: true, force: true })
})

function mockFetch(opts: { shasums?: string | null }) {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('versions.json')) return Response.json({ stable: VERSION, versions: [{ version: VERSION, files: [fileKey] }] })
    if (url.endsWith('SHASUMS256.txt')) return opts.shasums == null ? new Response('', { status: 404 }) : new Response(opts.shasums)
    return new Response(CORRUPT, { status: 200, headers: { 'Content-Length': String(CORRUPT.length) } })
  }) as typeof fetch
}

const packDir = () => path.join(dir, 'data', 'shell-cache', `${VERSION}-${fileKey}`)

test('parseShaSums 按文件名匹配', () => {
  const text = `${'a'.repeat(64)}  nwjs-v0.1.0-win-x64.zip\n${'B'.repeat(64)} *nwjs-v0.1.0-osx-arm64.zip\n`
  expect(parseShaSums(text, 'nwjs-v0.1.0-osx-arm64.zip')).toBe('b'.repeat(64))
  expect(parseShaSums(text, 'nwjs-v0.1.0-linux-x64.tar.gz')).toBeUndefined()
})

test('fetchNwSha256：网络失败降级为 undefined，任务取消继续抛出', async () => {
  global.fetch = jest.fn(async () => {
    throw new Error('offline')
  }) as typeof fetch
  await expect(fetchNwSha256(VERSION, archiveName)).resolves.toBeUndefined()

  const abort = new AbortController()
  abort.abort(new Error('已取消'))
  await expect(fetchNwSha256(VERSION, archiveName, abort.signal)).rejects.toThrow('已取消')
})

test('解压失败且压缩包未校验：删除压缩包', async () => {
  mockFetch({ shasums: null })
  await expect(ensureLatestNwShellSource({ toolkitRoot: dir })).rejects.toThrow(/已删除压缩包/)
  expect(fs.existsSync(path.join(packDir(), archiveName))).toBe(false)
  expect(fs.existsSync(path.join(packDir(), 'extract'))).toBe(false)
})

test('解压失败但压缩包已校验：保留压缩包', async () => {
  mockFetch({ shasums: `${sha(CORRUPT)}  ${archiveName}\n` })
  await expect(ensureLatestNwShellSource({ toolkitRoot: dir })).rejects.toThrow(/校验通过，已保留/)
  expect(fs.existsSync(path.join(packDir(), archiveName))).toBe(true)
  expect(fs.existsSync(path.join(packDir(), 'extract'))).toBe(false)
})

test('已有压缩包校验不符：删除后重新下载', async () => {
  mockFetch({ shasums: `${sha(CORRUPT)}  ${archiveName}\n` })
  fs.mkdirSync(packDir(), { recursive: true })
  fs.writeFileSync(path.join(packDir(), archiveName), 'stale')
  await expect(ensureLatestNwShellSource({ toolkitRoot: dir })).rejects.toThrow(/解压/)
  expect(fs.readFileSync(path.join(packDir(), archiveName))).toEqual(CORRUPT)
})

test('pruneShellCacheParts 只删其它版本的压缩包与 .part', () => {
  const cache = path.join(dir, 'cache')
  const keep = path.join(cache, 'v2-osx-arm64')
  const other = path.join(cache, 'v1-osx-arm64')
  fs.mkdirSync(path.join(other, 'extract'), { recursive: true })
  fs.mkdirSync(keep, { recursive: true })
  fs.writeFileSync(path.join(other, 'nwjs-v1-osx-arm64.zip.part'), '')
  fs.writeFileSync(path.join(other, 'nwjs-v1-osx-arm64.zip'), '')
  fs.writeFileSync(path.join(keep, 'nwjs-v2-osx-arm64.zip.part'), '')
  pruneShellCacheParts(keep)
  expect(fs.readdirSync(other)).toEqual(['extract'])
  expect(fs.readdirSync(keep)).toEqual(['nwjs-v2-osx-arm64.zip.part'])
})
