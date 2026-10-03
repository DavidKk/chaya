/** @jest-environment jsdom */
import { makeEdgeGameTools } from '@/components/webmcp/edge/game'
import { type CloudLibraryEntry, cloudLibraryStorage } from '@/lib/browser/cloud-library'
import { type CloudGame, inspectCloudGame, installCloudShell } from '@/lib/browser/cloud-prepare-game'
import { startCloudShellTask } from '@/lib/browser/cloud-shell-task'
import { writeCloudWindow } from '@/lib/browser/cloud-window'
import type { NwWindowConfig } from '@/lib/game/nw-window'

jest.mock('@/lib/browser/cloud-library', () => ({
  CLOUD_LIBRARY_CHANGED_EVENT: 'cloud-library-changed',
  cloudLibraryStorage: jest.fn(),
  readCloudGameId: () => 'g1',
  selectCloudGameId: jest.fn(),
}))
jest.mock('@/lib/browser/cloud-prepare-game', () => ({
  inspectCloudGame: jest.fn(),
  installCloudPlugins: jest.fn(),
  clearCloudPlugins: jest.fn(),
  installCloudShell: jest.fn(),
}))
jest.mock('@/lib/browser/cloud-window', () => ({ writeCloudWindow: jest.fn() }))
jest.mock('@/lib/browser/cloud-shell-task', () => ({ startCloudShellTask: jest.fn() }))

const ctx = { signal: new AbortController().signal }
const dir = (name: string, permission: PermissionState = 'granted') => ({ name, queryPermission: async () => permission }) as unknown as FileSystemDirectoryHandle

function entry(game: Partial<CloudGame> = {}): CloudLibraryEntry {
  const picked = dir('Game')
  return {
    item: { id: 'g1', gameRoot: 'browser:g1', name: 'Game', remark: '备注名', hasShell: false } as CloudLibraryEntry['item'],
    game: { picked, content: picked, os: 'win', pluginsInstalled: false, ...game },
  }
}

const tools = makeEdgeGameTools({ gameOnline: () => false, quit: jest.fn(), serviceMode: 'vercel' })

beforeEach(() => jest.clearAllMocks())

describe('edge game tools', () => {
  it('status reports an empty library like an unbound local game', async () => {
    jest.mocked(cloudLibraryStorage).mockResolvedValue([])
    expect(await tools.chaya_game_status({}, ctx)).toEqual({ ready: false, serviceMode: 'vercel', error: expect.any(String), gameRoot: null })
  })

  it('status maps the inspected game onto the shared view', async () => {
    const base = entry()
    const www = dir('www')
    jest.mocked(cloudLibraryStorage).mockResolvedValue([base])
    jest.mocked(inspectCloudGame).mockResolvedValue({
      ...base.game,
      content: www,
      existingShell: 'Game.exe',
      nwPackage: { name: 'pkg', window: { title: '标题' } as NwWindowConfig },
      plugins: [{ name: 'ChayaEdit', fileExists: true, registered: true, enabled: true } as never],
      cacheEntries: 12,
      footprint: { contentBytes: 2048, shellBytes: null },
    })
    expect(await tools.chaya_game_status({}, ctx)).toEqual({
      ready: true,
      serviceMode: 'vercel',
      gameRoot: 'browser:g1',
      name: '备注名',
      title: '标题',
      contentRoot: 'Game/www',
      kind: 'www',
      remote: false,
      os: 'win',
      shell: { hasShell: true, bundled: false, shellApp: 'Game.exe' },
      plugins: [{ name: 'ChayaEdit', installed: true, enabled: true }],
      pluginsReady: 1,
      pluginsTotal: 1,
      translateCache: { entries: 12, file: null, sizeBytes: null },
      sharedCache: null,
      footprint: { contentBytes: 2048, contentLabel: '2 KB', shellBytes: null, shellLabel: null },
      fingerprint: null,
      gameOnline: false,
    })
  })

  it('status still refuses to prompt for directory permission', async () => {
    const picked = dir('Game', 'prompt')
    jest.mocked(cloudLibraryStorage).mockResolvedValue([entry({ picked, content: picked })])
    await expect(tools.chaya_game_status({}, ctx)).rejects.toMatchObject({ webMcpCode: 'permission_required' })
  })

  it('window reads package.json and writes through the content handle', async () => {
    const nwPackage = { name: 'pkg', window: { width: 816 } as NwWindowConfig }
    const base = entry({ nwPackage })
    jest.mocked(cloudLibraryStorage).mockResolvedValue([base])
    jest.mocked(inspectCloudGame).mockResolvedValue(base.game)
    expect(await tools.chaya_game_window({}, ctx)).toEqual({ package: nwPackage })

    const next = { name: 'pkg', window: { width: 1280 } as NwWindowConfig }
    jest.mocked(writeCloudWindow).mockResolvedValue(next)
    expect(await tools.chaya_game_window({ window: { width: 1280 } }, ctx)).toEqual({ package: next })
    expect(writeCloudWindow).toHaveBeenCalledWith(base.game.content, { width: 1280 }, 'Game')
    expect(cloudLibraryStorage).toHaveBeenLastCalledWith([expect.objectContaining({ game: expect.objectContaining({ nwPackage: next }) })])
  })

  it('plugins install / clear return the shared plugin counts', async () => {
    const base = entry()
    jest.mocked(cloudLibraryStorage).mockResolvedValue([base])
    const plugin = (ready: boolean) => ({ name: 'ChayaEdit', fileExists: ready, registered: ready, enabled: ready }) as never
    jest.mocked(inspectCloudGame).mockResolvedValue({ ...base.game, plugins: [plugin(true)] })
    expect(await tools.chaya_game_plugins_install({}, ctx)).toEqual({
      installed: true,
      plugins: [{ name: 'ChayaEdit', installed: true, enabled: true }],
      pluginsReady: 1,
      pluginsTotal: 1,
      hint: expect.any(String),
    })
    jest.mocked(inspectCloudGame).mockResolvedValue({ ...base.game, plugins: [plugin(false)] })
    expect(await tools.chaya_game_plugins_clear({}, ctx)).toEqual({
      cleared: true,
      plugins: [{ name: 'ChayaEdit', installed: false, enabled: false }],
      pluginsReady: 0,
      pluginsTotal: 1,
    })
  })

  it('shell_install reports a pending Windows task in the shared shape', async () => {
    const base = entry()
    jest.mocked(cloudLibraryStorage).mockResolvedValue([base])
    jest.mocked(inspectCloudGame).mockResolvedValue(base.game)
    jest.mocked(startCloudShellTask).mockResolvedValue({ id: 't1', needsFile: Promise.resolve(true), done: new Promise(() => {}) } as never)
    expect(await tools.chaya_game_shell_install({}, ctx)).toEqual({
      pending: true,
      hasShell: false,
      shellApp: null,
      taskId: 't1',
      downloadUrl: null,
      hint: expect.any(String),
    })
  })

  it('shell_install hands Linux users a download link in the shared shape', async () => {
    const base = entry({ os: 'linux' })
    jest.mocked(cloudLibraryStorage).mockResolvedValue([base])
    jest.mocked(inspectCloudGame).mockResolvedValue(base.game)
    jest.mocked(installCloudShell).mockResolvedValue({ hint: '解压', downloadUrl: 'https://dl.nwjs.io/x.tar.gz' })
    expect(await tools.chaya_game_shell_install({}, ctx)).toEqual({
      pending: true,
      hasShell: false,
      shellApp: null,
      taskId: null,
      downloadUrl: 'https://dl.nwjs.io/x.tar.gz',
      hint: '解压',
    })
  })
})
