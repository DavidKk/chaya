jest.mock('@/lib/service-mode', () => ({ canUseDisk: () => false }))
jest.mock('@/lib/service-mode/mode', () => ({ canUseDisk: () => false }))
jest.mock('@/services/log/file-store', () => ({
  appendLogToFile: jest.fn(),
  clearLogFiles: jest.fn(),
  loadLogsFromFiles: jest.fn(() => []),
  pluginLogFileStats: jest.fn(),
  resolvePluginLogDir: jest.fn(),
}))

import { appendLog, clearLogs, listLogs, logBusStats } from '@/services/log/bus'

test('listLogs applies q before the limit', () => {
  clearLogs()
  appendLog({ source: 'svc', message: 'needle early' })
  for (let i = 0; i < 5; i += 1) appendLog({ source: 'svc', message: `noise ${i}` })
  expect(listLogs({ limit: 2 }).map((e) => e.message)).toEqual(['noise 3', 'noise 4'])
  expect(listLogs({ limit: 2, q: 'NEEDLE' }).map((e) => e.message)).toEqual(['needle early'])
  expect(listLogs({ q: 'svc' })).toHaveLength(6)
})

test('bounds retained debug logs by count and bytes, then releases memory on clear', () => {
  clearLogs()
  for (let i = 0; i < 2100; i++) appendLog({ source: 'svc', level: 'debug', message: String(i) })
  expect(logBusStats()).toMatchObject({ entries: 2000, memory: { droppedEntries: 100, maxBytes: 8 * 1024 ** 2 } })
  for (let i = 0; i < 2000; i++) appendLog({ source: 'svc', level: 'debug', message: String(i), meta: { payload: '\u4e2d'.repeat(100000) } })
  expect(logBusStats().memory.sizeBytes).toBeLessThanOrEqual(8 * 1024 ** 2)
  expect(listLogs({ limit: 1 })[0].message).toBe('1999')
  clearLogs()
  expect(logBusStats()).toMatchObject({ entries: 0, memory: { sizeBytes: 0 } })
})
