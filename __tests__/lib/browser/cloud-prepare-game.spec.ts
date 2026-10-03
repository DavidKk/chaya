import { clearCloudPlugins, configureCloudConnection, installCloudPlugins, installCloudShell, selectCloudGame, uninstallCloudShell } from '@/lib/browser/cloud-prepare-game'
import * as fsa from '@/lib/browser/fsa'

jest.mock('@/lib/browser/fsa', () => ({
  getFsaSupport: jest.fn(() => ({ ok: true })),
  pickDirectory: jest.fn(),
  resolveContentRootHandle: jest.fn(),
  detectClientOs: jest.fn(() => 'mac'),
  getDir: jest.fn(),
  readTextFile: jest.fn(),
  dirExists: jest.fn(() => false),
  fileExists: jest.fn(() => false),
  ensurePath: jest.fn(),
  writeTextFile: jest.fn(),
}))
jest.mock('@/lib/browser/nw-shell-fsa', () => ({
  isCompleteMacShell: jest.fn(() => false),
  isCompleteWinShell: jest.fn(() => false),
}))

const picked = { name: 'Game' } as FileSystemDirectoryHandle
const content = { name: 'www' } as FileSystemDirectoryHandle
const removeEntry = jest.fn()
const raw = 'var $plugins = [{"name":"OriginalPlugin","status":true,"parameters":{}}];'
let fetchMock: jest.Mock
beforeEach(() => {
  jest.mocked(fsa.pickDirectory).mockResolvedValue(picked)
  jest.mocked(fsa.resolveContentRootHandle).mockResolvedValue(content)
  jest.mocked(fsa.getDir).mockResolvedValue({ removeEntry } as unknown as FileSystemDirectoryHandle)
  jest.mocked(fsa.readTextFile).mockResolvedValue(raw)
  fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '// plugin' })
  jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://chaya.test' } } })
})
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

test('selecting a game never downloads, creates files or installs anything', async () => {
  const game = await selectCloudGame()
  expect(game).toMatchObject({ picked, content, pluginsInstalled: false })
  expect(fsa.writeTextFile).not.toHaveBeenCalled()
  expect(fsa.ensurePath).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('installing plugins preserves game plugins', async () => {
  await installCloudPlugins(await selectCloudGame())
  const writes = jest.mocked(fsa.writeTextFile).mock.calls
  const registration = writes.find((call) => call[1] === 'plugins.js')![2]
  expect(registration).toContain('OriginalPlugin')
  expect(registration).toContain('ChayaLoader')
})

test('invalid plugin registration fails before any mutation', async () => {
  jest.mocked(fsa.readTextFile).mockResolvedValue('not a plugin list')
  await expect(installCloudPlugins(await selectCloudGame())).rejects.toThrow('未安装插件')
  expect(fsa.writeTextFile).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('failed plugin download leaves registration and files untouched', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'failed' })
  await expect(installCloudPlugins(await selectCloudGame())).rejects.toThrow('500')
  expect(fsa.writeTextFile).not.toHaveBeenCalled()
  expect(fsa.ensurePath).not.toHaveBeenCalled()
})

test('macOS shell cannot accidentally use browser extraction', async () => {
  await expect(installCloudShell(await selectCloudGame())).rejects.toThrow('终端')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(fsa.writeTextFile).not.toHaveBeenCalled()
})

test('Windows shell goes through the download center task, not installCloudShell', async () => {
  const game = await selectCloudGame()
  await expect(installCloudShell({ ...game, os: 'win' })).rejects.toThrow('下载中心')
  expect(fsa.writeTextFile).not.toHaveBeenCalled()
})

test('clearing plugins keeps the game registration', async () => {
  const game = await selectCloudGame()
  jest.mocked(fsa.readTextFile).mockResolvedValue('var $plugins = [{"name":"OriginalPlugin","status":true},{"name":"ChayaLoader","status":true}];')
  await clearCloudPlugins(game)
  const registration = jest.mocked(fsa.writeTextFile).mock.calls[0][2]
  expect(registration).toContain('OriginalPlugin')
  expect(registration).not.toContain('ChayaLoader')
})

test('connecting refreshes plugin files and writes a room id, link token and link-only logging', async () => {
  const game = await selectCloudGame()
  jest.mocked(fsa.readTextFile).mockResolvedValue('var $plugins = [{"name":"ChayaLoader","status":true}];')
  await configureCloudConnection(game, 'library-room-123')
  expect(fetchMock).toHaveBeenCalled()
  const env = jest.mocked(fsa.writeTextFile).mock.calls.find((call) => call[1] === 'ChayaEnv.js')![2]
  expect(env).toContain('window.CHAYA_GAME_ID = "library-room-123"')
  expect(env).toMatch(/window\.CHAYA_LINK_TOKEN = "[0-9a-f]{64}"/)
  expect(env).toContain('window.CHAYA_LOG_TRANSPORT = "link"')
  expect(env).not.toContain('window.CHAYA_LOG_URL =')
})

test('connecting requires installed plugins', async () => {
  const game = await selectCloudGame()
  await expect(configureCloudConnection(game, 'library-room-123')).rejects.toThrow('请先安装插件')
  expect(fsa.writeTextFile).not.toHaveBeenCalled()
})

test('uninstalling removes only the detected Chaya shell entry', async () => {
  const rootRemove = jest.fn()
  const root = { name: 'Game', removeEntry: rootRemove } as unknown as FileSystemDirectoryHandle
  jest.mocked(fsa.dirExists).mockImplementation(async (_dir, name) => name === 'Chaya')
  const game = { picked: root, content: root, os: 'win' as const, pluginsInstalled: false }
  expect(await uninstallCloudShell({ ...game, existingShell: 'Chaya' })).toBe(1)
  expect(rootRemove).toHaveBeenCalledWith('Chaya', { recursive: true })
  rootRemove.mockClear()
  expect(await uninstallCloudShell({ ...game, existingShell: 'Game.exe' })).toBe(0)
  expect(await uninstallCloudShell(game)).toBe(0)
  expect(rootRemove).not.toHaveBeenCalled()
})
