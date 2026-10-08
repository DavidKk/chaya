import type { CloudGame } from '@/lib/browser/cloud-prepare-game'
import { BrowserGameDataError, queryBrowserGamePermission, readBrowserCommonEvents, requestBrowserGamePermission } from '@/lib/browser/game-data-reader'

jest.mock('@/lib/browser/game-data-worker-client', () => ({
  parseGameJsonBatch: async (texts: string[], signal: AbortSignal) => {
    if (signal.aborted) throw signal.reason
    return texts.map((text) => JSON.parse(text) as unknown)
  },
}))

function file(text: string, lastModified = 1): File {
  return { size: text.length, lastModified, text: async () => text } as File
}

function gameWithFiles(files: Record<string, string>, permission: PermissionState = 'granted'): CloudGame {
  const data = {
    getFileHandle: jest.fn(async (name: string) => {
      if (!(name in files)) throw new DOMException('missing', 'NotFoundError')
      return { getFile: async () => file(files[name]) }
    }),
  } as unknown as FileSystemDirectoryHandle
  const picked = {
    queryPermission: jest.fn(async () => permission),
    requestPermission: jest.fn(async () => permission),
  } as unknown as FileSystemDirectoryHandle
  const content = { getDirectoryHandle: jest.fn(async (name: string) => (name === 'data' ? data : Promise.reject(new Error('missing')))) } as unknown as FileSystemDirectoryHandle
  return { picked, content, os: 'win', pluginsInstalled: false }
}

const baseFiles = {
  'CommonEvents.json': JSON.stringify([null, { id: 1, name: 'Start', trigger: 0, switchId: 0, list: [] }]),
  'System.json': JSON.stringify({ switches: [null, 'Started'], variables: [null, 'Count'] }),
  'Items.json': '[null]',
  'Weapons.json': '[null]',
  'Armors.json': '[null]',
  'Actors.json': '[null]',
  'Troops.json': '[null]',
  'Enemies.json': '[null]',
  'MapInfos.json': JSON.stringify([null, { id: 1, name: 'Town' }, { id: 2, name: 'Field' }]),
  'Map001.json': JSON.stringify({ displayName: 'Town', width: 10, height: 8, events: [null] }),
  'Map002.json': '{broken',
}

describe('browser game data reader', () => {
  it('does not prompt while checking permission', async () => {
    const game = gameWithFiles(baseFiles, 'prompt')
    await expect(queryBrowserGamePermission(game)).resolves.toBe('prompt')
    expect((game.picked as never as { requestPermission: jest.Mock }).requestPermission).not.toHaveBeenCalled()
  })

  it('requests permission only through the explicit action', async () => {
    const game = gameWithFiles(baseFiles)
    await expect(requestBrowserGamePermission(game)).resolves.toBe('granted')
    expect((game.picked as never as { requestPermission: jest.Mock }).requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('builds an index while isolating a malformed map', async () => {
    const result = await readBrowserCommonEvents('game-a', gameWithFiles(baseFiles))
    expect(result).toMatchObject({ source: 'browser', mapsScanned: true, mapsFailed: 1 })
    expect(result.events[0]?.name).toBe('Start')
    expect(result.mapIndex.nodes.find((node) => node.id === 1)?.name).toBe('Town')
  })

  it('stops before reading a file over the size limit', async () => {
    const game = gameWithFiles(baseFiles)
    const data = await game.content.getDirectoryHandle('data')
    ;(data.getFileHandle as jest.Mock).mockImplementationOnce(async () => ({
      getFile: async () => ({ size: 65 * 1024 * 1024, lastModified: 1, text: jest.fn() }),
    }))
    await expect(readBrowserCommonEvents('game-large', game)).rejects.toMatchObject<Partial<BrowserGameDataError>>({ code: 'too-large' })
  })

  it('honors cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(readBrowserCommonEvents('game-cancel', gameWithFiles(baseFiles), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
