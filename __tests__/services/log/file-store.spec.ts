import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { type LogEntry } from '@/lib/log'
import { appendLogToFile, clearLogFiles, flushLogFiles, loadLogsFromFiles, pluginLogFileStats } from '@/services/log/file-store'

let logDir: string
let previousLevel: string | undefined
const entry = (message: string, ts = Date.now()) => JSON.stringify({ ts, source: 'test', message, level: 'debug' })
const file = () => path.join(logDir, `${new Date().toISOString().slice(0, 10)}.ndjson`)

beforeEach(() => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-logs-'))
  previousLevel = process.env.CHAYA_LOG_LEVEL
  delete process.env.CHAYA_LOG_LEVEL
})
afterEach(() => {
  flushLogFiles()
  jest.useRealTimers()
  if (previousLevel === undefined) delete process.env.CHAYA_LOG_LEVEL
  else process.env.CHAYA_LOG_LEVEL = previousLevel
  fs.rmSync(logDir, { recursive: true, force: true })
})

const logEntry = (message: string, level: LogEntry['level'] = 'info'): LogEntry => ({ id: message, ts: Date.now(), source: 'test', message, level })

it('hydrates recent records from a multi-GB sparse log without reading the whole file', () => {
  const fd = fs.openSync(file(), 'w')
  fs.ftruncateSync(fd, 3 * 1024 ** 3)
  fs.writeSync(fd, `\n${entry('recent 1')}\n${entry('recent 2')}\n`, 3 * 1024 ** 3)
  fs.closeSync(fd)
  const read = jest.spyOn(fs, 'readSync')
  expect(loadLogsFromFiles({ logDir, limit: 2 }).map((e) => e.message)).toEqual(['recent 1', 'recent 2'])
  expect(read.mock.results.reduce((sum, result) => sum + Number(result.value), 0)).toBeLessThanOrEqual(64 * 1024)
})

it('preserves UTF-8 lines across read boundaries and tolerates malformed trailing records', () => {
  const messages = Array.from({ length: 120 }, (_, i) => `${i}: ${'\u4e2d'.repeat(500)}`)
  const ts = Date.now()
  fs.writeFileSync(file(), messages.map((message, i) => entry(message, ts - 120 + i)).join('\n') + '\ninvalid tail')
  expect(loadLogsFromFiles({ logDir, limit: 80 }).map((e) => e.message)).toEqual(messages.slice(-80))
})

it('bounds startup I/O even when no valid records exist', () => {
  const fd = fs.openSync(file(), 'w')
  fs.ftruncateSync(fd, 3 * 1024 ** 3)
  fs.closeSync(fd)
  const read = jest.spyOn(fs, 'readSync')
  expect(loadLogsFromFiles({ logDir })).toEqual([])
  expect(read.mock.results.reduce((sum, result) => sum + Number(result.value), 0)).toBe(4 * 1024 * 1024)
})

it('falls back to earlier days and applies timestamp retention', () => {
  const ts = Date.now()
  const yesterday = new Date(ts - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  fs.writeFileSync(path.join(logDir, `${yesterday}.ndjson`), `${entry('old', ts - 20 * 24 * 60 * 60 * 1000)}\n${entry('yesterday', ts - 24 * 60 * 60 * 1000)}\n`)
  fs.writeFileSync(file(), entry('today', ts))
  expect(loadLogsFromFiles({ logDir, limit: 10 }).map((e) => e.message)).toEqual(['yesterday', 'today'])
  expect(loadLogsFromFiles({ logDir, limit: 0 })).toEqual([])
})

it('persists info and success but never persists debug, including forced writes', () => {
  appendLogToFile(logEntry('debug', 'debug'), logDir)
  appendLogToFile(logEntry('info'), logDir)
  appendLogToFile(logEntry('success', 'ok'), logDir)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['info', 'success'])
  process.env.CHAYA_LOG_LEVEL = 'debug'
  appendLogToFile(logEntry('detailed', 'debug'), logDir)
  appendLogToFile(logEntry('forced debug', 'debug'), logDir, { force: true })
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['info', 'success'])
  process.env.CHAYA_LOG_LEVEL = 'error'
  appendLogToFile(logEntry('warning', 'warn'), logDir)
  appendLogToFile(logEntry('failure', 'fail'), logDir)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['info', 'success', 'failure'])
})

it('batches a burst into one write within 100ms and exposes the actual persistence policy', () => {
  jest.useFakeTimers()
  const append = jest.spyOn(fs, 'appendFileSync')
  for (let i = 0; i < 100; i++) appendLogToFile(logEntry(`record ${i}`), logDir)
  expect(append).not.toHaveBeenCalled()
  jest.advanceTimersByTime(100)
  expect(append).toHaveBeenCalledTimes(1)
  expect(loadLogsFromFiles({ logDir })).toHaveLength(100)
  expect(pluginLogFileStats(logDir)).toMatchObject({
    files: 1,
    policy: {
      minimumLevel: 'info',
      flushIntervalMs: 100,
      maxFileBytes: 32 * 1024 ** 2,
      maxTotalBytes: 256 * 1024 ** 2,
      retentionDays: 14,
      automaticCleanup: true,
      readWindowDays: 14,
    },
  })
})

it('flushes a full batch before the timer to bound queued memory', () => {
  jest.useFakeTimers()
  const append = jest.spyOn(fs, 'appendFileSync')
  for (let i = 0; i < 100; i++) appendLogToFile({ ...logEntry(`${i}: ${'x'.repeat(1000)}`), id: String(i) }, logDir)
  expect(append).toHaveBeenCalledTimes(1)
  jest.advanceTimersByTime(100)
  expect(append).toHaveBeenCalledTimes(2)
  expect(loadLogsFromFiles({ logDir })).toHaveLength(100)
})

it('does not resurrect cleared records and keeps separate journals independent', () => {
  jest.useFakeTimers()
  const slowDir = path.join(logDir, 'slow-http')
  appendLogToFile(logEntry('ordinary'), logDir)
  appendLogToFile(logEntry('slow', 'warn'), slowDir)
  clearLogFiles(logDir)
  jest.advanceTimersByTime(100)
  expect(loadLogsFromFiles({ logDir })).toEqual([])
  expect(loadLogsFromFiles({ logDir: slowDir }).map((e) => e.message)).toEqual(['slow'])
  appendLogToFile(logEntry('new'), logDir)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['new'])
  clearLogFiles(logDir)
  expect(loadLogsFromFiles({ logDir })).toEqual([])
})

function sparseFile(target: string, size: number, tail = '') {
  const fd = fs.openSync(target, 'w')
  fs.ftruncateSync(fd, size)
  if (tail) fs.writeSync(fd, tail, size - Buffer.byteLength(tail))
  fs.closeSync(fd)
}

it('rotates full daily files and reads records from the archive and active file', () => {
  const old = `\n${JSON.stringify(logEntry('before rotation'))}\n`
  sparseFile(file(), 32 * 1024 ** 2, old)
  appendLogToFile(logEntry('after rotation'), logDir)
  flushLogFiles(logDir)
  expect(fs.readdirSync(logDir).filter((name) => name.endsWith('.ndjson'))).toHaveLength(2)
  expect(fs.statSync(file()).size).toBeLessThan(1024)
  expect(loadLogsFromFiles({ logDir, limit: 2 }).map((e) => e.message)).toEqual(['before rotation', 'after rotation'])
})

it('removes oldest archives to enforce the total cap without touching unrelated files', () => {
  const day = new Date().toISOString().slice(0, 10)
  const archives = Array.from({ length: 9 }, (_, i) => path.join(logDir, `${day}.${1700000000000 + i}-abcd.ndjson`))
  for (const archive of archives) sparseFile(archive, 32 * 1024 ** 2)
  const unrelated = path.join(logDir, 'custom.ndjson')
  fs.writeFileSync(unrelated, 'unmanaged')
  expect(pluginLogFileStats(logDir).sizeBytes).toBe(256 * 1024 ** 2 + 9)
  expect(fs.existsSync(archives[0])).toBe(false)
  expect(fs.existsSync(archives[1])).toBe(true)
  expect(fs.readFileSync(unrelated, 'utf8')).toBe('unmanaged')
})

it('expires dated daily files and archives and applies an independent slow journal budget', () => {
  const expiredDay = new Date(Date.now() - 16 * 86400000).toISOString().slice(0, 10)
  const expired = [`${expiredDay}.ndjson`, `${expiredDay}.1700000000000-abcd.ndjson`]
  for (const name of expired) fs.writeFileSync(path.join(logDir, name), entry('expired'))
  const slowDir = path.join(logDir, 'slow-http')
  appendLogToFile(logEntry('ordinary'), logDir)
  appendLogToFile(logEntry('slow', 'warn'), slowDir)
  const stats = pluginLogFileStats(slowDir)
  expect(stats.policy).toMatchObject({ maxFileBytes: 4 * 1024 ** 2, maxTotalBytes: 32 * 1024 ** 2 })
  pluginLogFileStats(logDir)
  for (const name of expired) expect(fs.existsSync(path.join(logDir, name))).toBe(false)
  expect(loadLogsFromFiles({ logDir: slowDir }).map((e) => e.message)).toEqual(['slow'])
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['ordinary'])
})

it('compacts oversized legacy files using at most 4 MiB and discards debug records', () => {
  const tail = `\n${entry('debug')}\n${JSON.stringify(logEntry('keep warning', 'warn'))}\n`
  sparseFile(file(), 3 * 1024 ** 3, tail)
  const read = jest.spyOn(fs, 'readSync')
  expect(pluginLogFileStats(logDir).sizeBytes).toBeLessThan(1024)
  expect(read.mock.results.reduce((sum, result) => sum + Number(result.value), 0)).toBe(4 * 1024 ** 2)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['keep warning'])
})

it('bounds Unicode and cyclic payloads while preserving request diagnostics', () => {
  const meta: Record<string, unknown> = { payload: Array.from({ length: 100 }, () => '\u4e2d'.repeat(20000)), operationId: 'request-123', elapsedMs: 29000, status: 200 }
  meta.recursive = meta
  appendLogToFile({ ...logEntry('\u4e2d'.repeat(20000)), meta }, logDir)
  flushLogFiles(logDir)
  expect(fs.statSync(file()).size).toBeLessThanOrEqual(16 * 1024)
  expect(loadLogsFromFiles({ logDir })[0].meta).toMatchObject({ operationId: 'request-123', elapsedMs: 29000, status: 200 })
})

it('retries buffered records after a competing writer releases the lock', () => {
  jest.useFakeTimers()
  const lock = path.join(logDir, '.write-lock')
  fs.writeFileSync(lock, String(process.pid))
  appendLogToFile(logEntry('waiting'), logDir)
  jest.advanceTimersByTime(100)
  expect(fs.existsSync(file())).toBe(false)
  fs.unlinkSync(lock)
  jest.advanceTimersByTime(100)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['waiting'])
})

it('recovers a lock left by an exited process and clears archived history', () => {
  const lock = path.join(logDir, '.write-lock')
  fs.writeFileSync(lock, '2147483647')
  appendLogToFile(logEntry('recovered'), logDir)
  flushLogFiles(logDir)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['recovered'])
  expect(fs.existsSync(lock)).toBe(false)
  const day = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(path.join(logDir, `${day}.1700000000000-abcd.ndjson`), entry('archive'))
  clearLogFiles(logDir)
  expect(fs.readdirSync(logDir)).toEqual([])
})

it('defers clearing while locked and retains records appended after the clear', () => {
  jest.useFakeTimers()
  appendLogToFile(logEntry('old'), logDir)
  flushLogFiles(logDir)
  const lock = path.join(logDir, '.write-lock')
  fs.writeFileSync(lock, String(process.pid))
  clearLogFiles(logDir)
  expect(loadLogsFromFiles({ logDir })).toEqual([])
  appendLogToFile(logEntry('new'), logDir)
  fs.unlinkSync(lock)
  jest.advanceTimersByTime(100)
  expect(loadLogsFromFiles({ logDir }).map((e) => e.message)).toEqual(['new'])
})

it('bounds queued bytes during sustained lock contention and keeps newest records', () => {
  jest.useFakeTimers()
  const lock = path.join(logDir, '.write-lock')
  fs.writeFileSync(lock, String(process.pid))
  for (let i = 0; i < 2000; i++) appendLogToFile({ ...logEntry('x'.repeat(2000)), id: String(i) }, logDir)
  const stats = pluginLogFileStats(logDir).pending
  expect(stats.sizeBytes).toBeLessThanOrEqual(1024 ** 2)
  expect(stats.entries).toBeLessThanOrEqual(2000)
  expect(stats.droppedEntries).toBeGreaterThan(0)
  fs.unlinkSync(lock)
  flushLogFiles(logDir)
  const rows = loadLogsFromFiles({ logDir })
  expect(rows.at(-1)!.id).toBe('1999')
  expect(pluginLogFileStats(logDir).pending).toMatchObject({ sizeBytes: 0, entries: 0 })
})

it('bounds queued records and filenames when timestamps vary under lock contention', () => {
  jest.useFakeTimers()
  const lock = path.join(logDir, '.write-lock')
  fs.writeFileSync(lock, String(process.pid))
  for (let i = 0; i < 2200; i++) appendLogToFile(logEntry(String(i)), logDir)
  expect(pluginLogFileStats(logDir).pending.entries).toBeLessThanOrEqual(2000)
  for (let i = 0; i < 100; i++) appendLogToFile({ ...logEntry(String(i)), ts: Date.now() + i * 86400000 }, logDir)
  expect(pluginLogFileStats(logDir).pending.files).toBeLessThanOrEqual(32)
  clearLogFiles(logDir)
  fs.unlinkSync(lock)
  flushLogFiles(logDir)
})
