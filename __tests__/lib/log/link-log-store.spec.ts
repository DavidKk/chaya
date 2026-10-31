import { filterLogEntries } from '@/lib/log'
import { appendLinkLogs, clearLinkLogs, readLinkLogs, resetLinkLogs, subscribeLinkLogs } from '@/lib/log/link-log-store'

const entry = (id: number, ts: number, message = `m${id}`, level = 'info') => ({ id, ts, level, source: 'ChayaLink', message })

beforeEach(() => resetLinkLogs())

test('dedupes backlog re-sent on reconnect and notifies subscribers', () => {
  const fn = jest.fn()
  const unsub = subscribeLinkLogs(fn)
  appendLinkLogs([entry(1, 100), entry(2, 200)])
  const first = readLinkLogs()
  appendLinkLogs([entry(1, 100), entry(2, 200)])
  expect(readLinkLogs()).toBe(first)
  appendLinkLogs([entry(2, 200), entry(3, 300, 'boom', 'error')])
  expect(readLinkLogs().map((e) => e.message)).toEqual(['m1', 'm2', 'boom'])
  expect(readLinkLogs()[2].level).toBe('fail')
  expect(fn).toHaveBeenCalledTimes(2)
  unsub()
})

test('cleared entries do not come back with the next backlog; switching games resets that', () => {
  const now = Date.now()
  appendLinkLogs([entry(1, now - 1000)])
  clearLinkLogs()
  appendLinkLogs([entry(1, now - 1000), entry(2, now + 1000)])
  expect(readLinkLogs().map((e) => e.message)).toEqual(['m2'])
  resetLinkLogs()
  appendLinkLogs([entry(1, now - 1000)])
  expect(readLinkLogs()).toHaveLength(1)
})

test('shares the server filter semantics', () => {
  appendLinkLogs([entry(1, 100, 'alpha'), entry(2, 200, 'beta', 'warn'), entry(3, 300, 'alpha two')])
  expect(filterLogEntries(readLinkLogs(), { q: 'alpha' }).map((e) => e.ts)).toEqual([100, 300])
  expect(filterLogEntries(readLinkLogs(), { level: 'warn' })).toHaveLength(1)
  expect(filterLogEntries(readLinkLogs(), { since: 200, limit: 1 }).map((e) => e.ts)).toEqual([300])
})

test('bounds retained records and metadata across reconnect bursts', () => {
  const meta = { requestId: 'game-request', payload: 'x'.repeat(1000000) }
  const batch = Array.from({ length: 1200 }, (_, i) => ({ ...entry(i, i + 1), meta }))
  appendLinkLogs(batch)
  meta.requestId = 'mutated'
  expect(readLinkLogs()).toHaveLength(1000)
  expect(readLinkLogs()[0].message).toBe('m200')
  expect(readLinkLogs().at(-1)!.meta).toMatchObject({ requestId: 'game-request' })
  expect(Math.max(...readLinkLogs().map((row) => Buffer.byteLength(JSON.stringify(row))))).toBeLessThanOrEqual(16 * 1024)
  const current = readLinkLogs()
  appendLinkLogs(batch.slice(-1000))
  expect(readLinkLogs()).toBe(current)
})
