import { GET } from '@/app/api/game-agent/processes/route.server'
import * as processes from '@/services/game-agent/cli/live-processes.server'

const mode = { disk: true }
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode/mode', () => ({ canUseDisk: () => mode.disk }))

const ctx = { params: Promise.resolve({}) }

test.each([
  ['', false],
  ['?includeSystem=1', true],
  ['?includeSystem=true', false],
] as const)('GET %s explicitly selects process scope', async (query, includeSystem) => {
  const list = jest.spyOn(processes, 'listLiveAgentProcesses').mockResolvedValue([])
  const response = await GET(new Request(`http://localhost/api/game-agent/processes${query}`), ctx)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ processes: [], count: 0 })
  expect(list).toHaveBeenCalledWith({ includeSystem })
})

test('non-local service modes cannot inspect processes', async () => {
  mode.disk = false
  const list = jest.spyOn(processes, 'listLiveAgentProcesses').mockResolvedValue([])
  try {
    const response = await GET(new Request('http://localhost/api/game-agent/processes?includeSystem=1'), ctx)
    expect(response.status).toBe(404)
    expect(list).not.toHaveBeenCalled()
  } finally {
    mode.disk = true
  }
})
