/** @jest-environment jsdom */
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useCloudLibrary } from '@/components/dashboard/useCloudLibrary'
import { type CloudLibraryEntry, cloudLibraryStorage, requireCloudPermission } from '@/lib/browser/cloud-library'
import { type CloudGame, installCloudPlugins, installCloudShell, selectCloudGame, uninstallCloudShell } from '@/lib/browser/cloud-prepare-game'

const mockNotify = { success: jest.fn(), error: jest.fn(), info: jest.fn() }
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))
jest.mock('@/lib/browser/cloud-library', () => ({
  cloudLibraryStorage: jest.fn(),
  requireCloudPermission: jest.fn(),
  hasCloudPermission: jest.fn(async () => false),
  canQueryCloudPermission: jest.fn(() => false),
  readCloudGameId: jest.fn(() => null),
  selectCloudGameId: jest.fn(),
}))
jest.mock('@/lib/browser/cloud-prepare-game', () => ({
  selectCloudGame: jest.fn(),
  configureCloudConnection: jest.fn(),
  inspectCloudGame: jest.fn(async (game) => game),
  installCloudPlugins: jest.fn(),
  clearCloudPlugins: jest.fn(),
  installCloudShell: jest.fn(),
  uninstallCloudShell: jest.fn(),
}))
let saved: CloudLibraryEntry[]
let root: Root
let host: HTMLDivElement
let library: ReturnType<typeof useCloudLibrary>
function Harness() {
  const [id, setId] = useState<string | null>(null)
  const current = useCloudLibrary(true, id, setId)
  useEffect(() => {
    library = current
  }, [current])
  return null
}
function game(name: string): CloudGame {
  const picked = { name, isSameEntry: async (other: unknown) => other === picked } as FileSystemDirectoryHandle
  return { picked, content: { name: 'www' } as FileSystemDirectoryHandle, os: 'mac', pluginsInstalled: false }
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  saved = []
  jest.mocked(cloudLibraryStorage).mockImplementation(async (next) => {
    if (next) saved = next
    return saved
  })
  host = document.createElement('div')
  root = createRoot(host)
  await act(async () => root.render(createElement(Harness)))
})
afterEach(async () => {
  await act(async () => root.unmount())
})

test('selection adds to the existing library model without installing anything; repeats are deduplicated', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('First'))
  await act(async () => library.choose())
  expect(library.status.ready).toBe(true)
  expect(library.status.library).toHaveLength(1)
  expect(saved[0].item.name).toBe('First')
  await act(async () => library.choose())
  expect(library.status.library).toHaveLength(1)
  expect(installCloudPlugins).not.toHaveBeenCalled()
  expect(installCloudShell).not.toHaveBeenCalled()
})

test('multiple games can switch, rename, remove and restore from browser storage', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('First'))
  await act(async () => library.choose())
  const first = saved[0].item.gameRoot
  jest.mocked(selectCloudGame).mockResolvedValue(game('Second'))
  await act(async () => library.choose())
  expect(library.active?.item.name).toBe('Second')
  await act(async () => library.select(first))
  await act(async () => library.rename('My game'))
  expect(library.active?.item.remark).toBe('My game')
  await act(async () => library.remove(first))
  expect(library.active?.item.name).toBe('Second')
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(createElement(Harness)))
  expect(library.status.library).toHaveLength(1)
  expect(library.active?.item.name).toBe('Second')
})

test('a denied restored directory permission prevents plugin writes', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('First'))
  await act(async () => library.choose())
  jest.mocked(requireCloudPermission).mockRejectedValueOnce(new Error('permission denied'))
  await act(async () => library.installPlugins())
  expect(installCloudPlugins).not.toHaveBeenCalled()
  expect(mockNotify.error).toHaveBeenCalledWith('permission denied')
})

test('plugin installation includes the selected library room id', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('Connected game'))
  await act(async () => library.choose())
  await act(async () => library.installPlugins())
  expect(installCloudPlugins).toHaveBeenCalledWith(library.active!.game, library.active!.item.id)
})

test('macOS shell uninstall deletes in the browser after asking for permission', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('Mac game'))
  await act(async () => library.choose())
  jest.mocked(uninstallCloudShell).mockResolvedValueOnce(1)
  await act(async () => library.uninstallShell())
  expect(requireCloudPermission).toHaveBeenCalled()
  expect(uninstallCloudShell).toHaveBeenCalledWith(library.active!.game)
  expect(mockNotify.success).toHaveBeenCalled()
  expect(library.macDialogOpen).toBe(false)
})

test('macOS shell uninstall refused by the browser only shows the error', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('Mac game'))
  await act(async () => library.choose())
  mockNotify.error.mockClear()
  jest.mocked(uninstallCloudShell).mockRejectedValueOnce(new DOMException('The object can not be modified in this way.', 'InvalidModificationError'))
  await act(async () => library.uninstallShell())
  expect(mockNotify.error).toHaveBeenCalledWith('The object can not be modified in this way.')
  expect(library.macDialogOpen).toBe(false)
})

test('macOS shell uninstall without permission only shows the error', async () => {
  jest.mocked(selectCloudGame).mockResolvedValue(game('Mac game'))
  await act(async () => library.choose())
  jest.mocked(uninstallCloudShell).mockClear()
  jest.mocked(requireCloudPermission).mockRejectedValueOnce(new Error('permission denied'))
  await act(async () => library.uninstallShell())
  expect(uninstallCloudShell).not.toHaveBeenCalled()
  expect(mockNotify.error).toHaveBeenCalledWith('permission denied')
  expect(library.macDialogOpen).toBe(false)
})
