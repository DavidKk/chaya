jest.mock('@/services/access/api', () => ({ mayAccessApi: jest.fn(async () => true) }))
jest.mock('@/services/disk-ops', () => ({ requireDisk: jest.fn(() => null) }))
jest.mock('@/services/updates/coordinator', () => ({
  updateCoordinator: { list: jest.fn(), check: jest.fn(), activate: jest.fn() },
  startUpdateInstall: jest.fn(),
}))

import { GET, POST } from '@/app/api/updates/route.server'
import { apiError } from '@/initializer/response'
import { mayAccessApi } from '@/services/access/api'
import { requireDisk } from '@/services/disk-ops'
import { startUpdateInstall, updateCoordinator } from '@/services/updates/coordinator'

const context = { params: Promise.resolve({}) }
const post = (body: unknown) => POST(new Request('http://localhost/api/updates', { method: 'POST', body: JSON.stringify(body) }), context)

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(mayAccessApi).mockResolvedValue(true)
  jest.mocked(requireDisk).mockReturnValue(null)
})

test('offline GET lists local versions and never refreshes the channel', async () => {
  jest.mocked(updateCoordinator.list).mockResolvedValue([])
  expect(await (await GET(new Request('http://localhost/api/updates'), context)).json()).toMatchObject({ ok: true, packages: [] })
  expect(updateCoordinator.check).not.toHaveBeenCalled()
})

test('explicit actions separate checking, background installation and local rollback', async () => {
  jest.mocked(updateCoordinator.check).mockResolvedValue([])
  expect((await post({ action: 'check' })).status).toBe(200)
  jest.mocked(startUpdateInstall).mockReturnValue({ job: { id: 'job', kind: 'update-package' }, reused: false } as ReturnType<typeof startUpdateInstall>)
  expect(await (await post({ action: 'install', packageId: 'chaya.test', version: '1.0.0' })).json()).toMatchObject({ ok: true, job: { id: 'job' } })
  expect(startUpdateInstall).toHaveBeenCalledWith('chaya.test', '1.0.0')
  await post({ action: 'rollback', packageId: 'chaya.test', version: '1.0.0' })
  expect(updateCoordinator.activate).toHaveBeenCalledWith('chaya.test', '1.0.0', true)
})

test('caller-supplied URLs do not replace required package identity', async () => {
  expect((await post({ action: 'install', url: 'https://evil.example/payload' })).status).toBe(400)
  expect(startUpdateInstall).not.toHaveBeenCalled()
  jest.mocked(startUpdateInstall).mockImplementation(() => {
    throw new Error('Invalid package ID')
  })
  const response = await post({ action: 'install', packageId: '../bad', version: '1.0.0' })
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPDATE_REJECTED' } })
})

test('management denial and cloud disk guards prevent update operations', async () => {
  jest.mocked(mayAccessApi).mockResolvedValue(false)
  expect((await post({ action: 'check' })).status).toBe(401)
  jest.mocked(mayAccessApi).mockResolvedValue(true)
  jest.mocked(requireDisk).mockReturnValue(apiError(403, 'NO_DISK', 'Unavailable'))
  expect((await post({ action: 'check' })).status).toBe(403)
  expect(updateCoordinator.check).not.toHaveBeenCalled()
})
