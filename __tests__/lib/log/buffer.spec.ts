import { LogBuffer } from '@/lib/log/buffer'
import { compactLogEntry, logEntryBytes, MAX_LOG_ENTRY_BYTES } from '@/lib/log/entry'
import type { LogEntry } from '@/lib/log/types'

const entry = (id: number, message = 'message', meta?: unknown): LogEntry => ({ id: String(id), ts: id, level: 'debug', source: 'test', message, meta })

it('evicts oldest records at the count limit and releases them on clear', () => {
  const buffer = new LogBuffer(2)
  for (let i = 0; i < 100; i++) buffer.append(entry(i))
  expect(buffer.list().map((row) => row.id)).toEqual(['98', '99'])
  expect(buffer.stats().droppedEntries).toBe(98)
  buffer.clear()
  expect(buffer.list()).toEqual([])
  expect(buffer.stats()).toMatchObject({ sizeBytes: 0, droppedEntries: 0 })
})

it('evicts by bytes before hitting the record limit and preserves the newest entry', () => {
  const buffer = new LogBuffer(2000, 16 * 1024)
  for (let i = 0; i < 100; i++) buffer.append(entry(i, '\u4e2d'.repeat(2000)))
  expect(buffer.stats().sizeBytes).toBeLessThanOrEqual(16 * 1024)
  expect(buffer.list().length).toBeLessThan(10)
  expect(buffer.list().at(-1)!.id).toBe('99')
})

it('detaches and bounds large cyclic metadata while preserving request correlation', () => {
  const payload = { text: 'x'.repeat(1000000), operationId: 'request-1', elapsedMs: 30000, self: undefined as unknown }
  payload.self = payload
  const compact = compactLogEntry(entry(1, 'x'.repeat(1000000), payload))
  payload.operationId = 'mutated'
  expect(compact.meta).toMatchObject({ operationId: 'request-1', elapsedMs: 30000 })
  expect(compact.meta).not.toBe(payload)
  expect(logEntryBytes(compact)).toBeLessThanOrEqual(MAX_LOG_ENTRY_BYTES)
  expect(compact.message.length).toBeLessThanOrEqual(2000)
})

it('handles escaped strings and metadata getters without retaining the input object', () => {
  const meta = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i), '\0'.repeat(1024)]))
  const compact = compactLogEntry(entry(1, '\0'.repeat(2000), meta))
  expect(Buffer.byteLength(`${JSON.stringify(compact)}\n`)).toBeLessThanOrEqual(MAX_LOG_ENTRY_BYTES)
  const hostile = {
    get value(): unknown {
      throw new Error('getter failed')
    },
  }
  expect(compactLogEntry(entry(2, 'valid', hostile)).meta).toEqual({ truncated: true })
})
