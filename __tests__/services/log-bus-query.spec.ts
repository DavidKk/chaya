jest.mock('@/lib/service-mode', () => ({ canUseDisk: () => false }))
jest.mock('@/services/log/file-store', () => ({
  appendLogToFile: jest.fn(),
  clearLogFiles: jest.fn(),
  loadLogsFromFiles: jest.fn(() => []),
  pluginLogFileStats: jest.fn(),
  resolvePluginLogDir: jest.fn(),
}))

import { appendLog, clearLogs, listLogs } from '@/services/log/bus'

test('listLogs applies q before the limit', () => {
  clearLogs()
  appendLog({ source: 'svc', message: 'needle early' })
  for (let i = 0; i < 5; i += 1) appendLog({ source: 'svc', message: `noise ${i}` })
  expect(listLogs({ limit: 2 }).map((e) => e.message)).toEqual(['noise 3', 'noise 4'])
  expect(listLogs({ limit: 2, q: 'NEEDLE' }).map((e) => e.message)).toEqual(['needle early'])
  expect(listLogs({ q: 'svc' })).toHaveLength(6)
})
