import { clearCloudPlugins, configureCloudConnection, installCloudPlugins, installCloudShell, selectCloudGame } from '@/lib/browser/cloud-prepare-game'
import * as fsa from '@/lib/browser/fsa'
import * as shell from '@/lib/browser/nw-shell-fsa'

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
  installWindowsShellFsa: jest.fn(),
  writeShellLaunchers: jest.fn(() => 'Chaya启动.bat'),
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
  expect(shell.installWindowsShellFsa).not.toHaveBeenCalled()
})

test('installing plugins preserves game plugins and does not install a shell', async () => {
  await installCloudPlugins(await selectCloudGame())
  const writes = jest.mocked(fsa.writeTextFile).mock.calls
  const registration = writes.find((call) => call[1] === 'plugins.js')![2]
  expect(registration).toContain('OriginalPlugin')
  expect(registration).toContain('ChayaLoader')
  expect(shell.installWindowsShellFsa).not.toHaveBeenCalled()
  expect(shell.writeShellLaunchers).not.toHaveBeenCalled()
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

test('Windows installation does not touch plugin registration', async () => {
  const game = await selectCloudGame()
  await installCloudShell({ ...game, os: 'win' })
  expect(shell.installWindowsShellFsa).toHaveBeenCalledWith(picked, undefined)
  expect(shell.writeShellLaunchers).toHaveBeenCalledWith(picked, 'win')
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

test('existing plugins can acquire a room id without reinstalling plugin files', async () => {
  const game = await selectCloudGame()
  jest.mocked(fsa.readTextFile).mockResolvedValue('var $plugins = [{"name":"ChayaLoader","status":true}];')
  await configureCloudConnection(game, 'library-room-123')
  expect(fsa.writeTextFile).toHaveBeenCalledTimes(1)
  expect(fsa.writeTextFile).toHaveBeenCalledWith(expect.anything(), 'ChayaEnv.js', expect.stringContaining('window.CHAYA_GAME_ID = "library-room-123"'))
  expect(fetchMock).not.toHaveBeenCalled()
})
