import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { GET, PUT } from '@/app/api/remote/settings/route.server'
import { DEFAULT_REMOTE_PLAY_HOST_SETTINGS, parseRemotePlayHostSettings } from '@/lib/runtime/remote-play-settings'
import { readRemotePlayHostSettings } from '@/services/runtime/remote-play-settings.server'

let dataDir = ''
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ requireDisk: () => null }))
jest.mock('@/lib/game/toolkit-data', () => ({ toolkitDataDir: () => dataDir }))

const ctx = { params: Promise.resolve({}) }
const get = () => GET(new Request('http://localhost/api/remote/settings'), ctx)
const put = (settings: unknown) => PUT(new Request('http://localhost/api/remote/settings', { method: 'PUT', body: JSON.stringify({ settings }) }), ctx)

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-remote-settings-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

it('defaults to a visible window and muted host speakers without creating a file', async () => {
  const response = await get()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, settings: DEFAULT_REMOTE_PLAY_HOST_SETTINGS })
  expect(fs.existsSync(path.join(dataDir, 'remote-play/settings.json'))).toBe(false)
})

it('persists shared host preferences and merges partial updates', async () => {
  expect((await put({ launchMode: 'silent' })).status).toBe(200)
  expect((await put({ muteHostAudio: false })).status).toBe(200)
  expect((await get()).status).toBe(200)
  expect(readRemotePlayHostSettings()).toEqual({ launchMode: 'silent', muteHostAudio: false })
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'remote-play/settings.json'), 'utf8'))
  expect(saved).toEqual({ launchMode: 'silent', muteHostAudio: false })
  expect(fs.readdirSync(path.join(dataDir, 'remote-play'))).toEqual(['settings.json'])
})

it.each([null, [], { launchMode: 'hidden' }, { muteHostAudio: 'true' }, { launchMode: null }, { muteHostAudio: 0 }])(
  'rejects invalid settings %p without replacing saved preferences',
  async (settings) => {
    await put({ launchMode: 'silent', muteHostAudio: false })
    const response = await put(settings)
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_SETTINGS')
    expect(readRemotePlayHostSettings()).toEqual({ launchMode: 'silent', muteHostAudio: false })
  }
)

it('ignores unknown fields and treats omitted values as defaults', async () => {
  await put({ launchMode: 'silent', unknown: true })
  expect(readRemotePlayHostSettings()).toEqual({ launchMode: 'silent', muteHostAudio: true })
  expect(parseRemotePlayHostSettings({ launchMode: undefined, muteHostAudio: undefined })).toEqual(DEFAULT_REMOTE_PLAY_HOST_SETTINGS)
})

it('reports corrupt saved configuration instead of silently launching with defaults', async () => {
  await put({ launchMode: 'silent' })
  fs.writeFileSync(path.join(dataDir, 'remote-play/settings.json'), '{broken')
  expect((await get()).status).toBe(500)
})

it('reports invalid stored fields as a server error without overwriting the file', async () => {
  await put({ launchMode: 'silent' })
  const file = path.join(dataDir, 'remote-play/settings.json')
  fs.writeFileSync(file, JSON.stringify({ launchMode: 'invalid' }))
  expect((await put({ muteHostAudio: false })).status).toBe(500)
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ launchMode: 'invalid' })
})
