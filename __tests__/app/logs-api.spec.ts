import { GET, POST } from '@/app/api/logs/route'
import * as files from '@/services/log/file-store'

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ canUseDisk: () => false }))
jest.mock('@/services/log/file-store', () => ({
  appendLogToFile: jest.fn(),
  clearLogFiles: jest.fn(),
  loadLogsFromFiles: jest.fn(),
  pluginLogFileStats: jest.fn(),
  resolvePluginLogDir: jest.fn(),
}))

test('Edge accepts and reads plugin logs without disk I/O or 501', async () => {
  const response = await POST(
    new Request('http://localhost/api/logs', {
      method: 'POST',
      body: JSON.stringify({ source: 'ChayaLink', message: 'state delivered' }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({}) }
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  const read = await GET(new Request('http://localhost/api/logs'), { params: Promise.resolve({}) })
  const data = await read.json()
  expect(data.entries).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'state delivered' })]))
  expect(data.stats.persistence).toBe('memory')
  for (const fn of [files.appendLogToFile, files.clearLogFiles, files.loadLogsFromFiles, files.pluginLogFileStats, files.resolvePluginLogDir]) expect(fn).not.toHaveBeenCalled()
})
