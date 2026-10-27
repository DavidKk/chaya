import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { emptyMemorySnapshot } from '@/lib/game-agent/companion/memory-durable'
import { tryNodeFsPath } from '@/plugins/mv/src/helpers/node/node-require'
import { pluginStorageCall } from '@/plugins/mv/src/helpers/storage/client'
import { flushPendingStorage, queueStorageMutation } from '@/plugins/mv/src/helpers/storage/pending'

jest.mock('@/plugins/mv/src/helpers/node/node-require', () => ({ tryNodeFsPath: jest.fn() }))
jest.mock('@/plugins/mv/src/helpers/storage/client', () => ({ pluginStorageCall: jest.fn() }))

const batch = (batchId: string, memoryEpoch = 1, recordingRevision = 1) => ({ schemaVersion: 1, batchId, memoryEpoch, recordingRevision, at: 1 })

describe('offline storage queue across companion management fences', () => {
  let root: string
  let file: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-pending-recording-'))
    file = path.join(root, 'chaya/translate/pending-mutations.ndjson')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    jest.mocked(tryNodeFsPath).mockReturnValue({ fs, path } as ReturnType<typeof tryNodeFsPath>)
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  const seed = (items: unknown[]) => fs.writeFileSync(file, items.map((item) => JSON.stringify(item)).join('\n') + '\n')

  it('drops stale records and legacy management without blocking translations and current records', async () => {
    seed([
      { id: 'stale', method: 'companion.commit', args: ['g1', batch('stale'), root] },
      { id: 'legacy', method: 'companion.commit', args: ['g1', { ...batch('legacy', 2, 3), clear: { libraryGameId: 'g1' } }, root] },
      { id: 'translation', method: 'game.append', args: ['g1', [{ id: 'line1', translated: 'hello' }], 'translation'] },
      { id: 'current', method: 'companion.commit', args: ['g1', batch('current', 2, 3), root] },
    ])
    jest
      .mocked(pluginStorageCall)
      .mockImplementation(async (method) => (method === 'companion.load' ? emptyMemorySnapshot({ memoryEpoch: 2, recordingRevision: 3 }) : (undefined as never)))
    await flushPendingStorage(root)
    const mutations = jest.mocked(pluginStorageCall).mock.calls.filter(([method]) => method !== 'companion.load')
    expect(mutations.map(([method, args]) => [method, args![1]])).toEqual([
      ['game.append', [{ id: 'line1', translated: 'hello' }]],
      ['companion.commit', batch('current', 2, 3)],
    ])
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('rechecks state after a commit races with a barrier and still drains later translations', async () => {
    seed([
      { id: 'racing', method: 'companion.commit', args: ['g1', batch('racing'), root] },
      { id: 'translation', method: 'game.append', args: ['g1', [], 'translation'] },
    ])
    let snapshot = emptyMemorySnapshot()
    jest.mocked(pluginStorageCall).mockImplementation(async (method) => {
      if (method === 'companion.load') return snapshot as never
      if (method === 'companion.commit') {
        snapshot = emptyMemorySnapshot({ recordingRevision: 2, recordingEnabled: false })
        throw new Error('stale')
      }
      return undefined as never
    })
    await flushPendingStorage(root)
    expect(pluginStorageCall).toHaveBeenLastCalledWith('game.append', ['g1', [], 'translation'])
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('retains genuine transport failures and their exact identities for later retry', async () => {
    const items = [
      { id: 'offline', method: 'companion.commit', args: ['g1', batch('offline'), root] },
      { id: 'translation', method: 'game.append', args: ['g1', [], 'translation'] },
    ]
    seed(items)
    jest.mocked(pluginStorageCall).mockImplementation(async (method) => {
      if (method === 'companion.load') return emptyMemorySnapshot() as never
      throw new Error('offline')
    })
    await expect(flushPendingStorage(root)).rejects.toThrow('offline')
    expect(
      fs
        .readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual(items)
    jest.mocked(pluginStorageCall).mockImplementation(async (method) => (method === 'companion.load' ? emptyMemorySnapshot() : (undefined as never)))
    await flushPendingStorage(root)
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('reports stale disposal to the current writer rather than acknowledging it as persisted', async () => {
    jest.mocked(pluginStorageCall).mockResolvedValue(emptyMemorySnapshot({ memoryEpoch: 2 }) as never)
    await expect(queueStorageMutation(root, 'companion.commit', ['g1', batch('old'), root])).rejects.toThrow('discarded')
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('reports stale disposal to every concurrent caller even when an earlier flush consumes both entries', async () => {
    jest.mocked(pluginStorageCall).mockResolvedValue(emptyMemorySnapshot({ memoryEpoch: 2 }) as never)
    const outcomes = await Promise.allSettled([
      queueStorageMutation(root, 'companion.commit', ['g1', batch('first'), root]),
      queueStorageMutation(root, 'companion.commit', ['g1', batch('second'), root]),
    ])
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected'])
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') expect(outcome.reason.message).toContain('discarded')
    }
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('drops disabled evidence and projections so they do not block translations', async () => {
    seed([
      { id: 'evidence', method: 'companion.commit', args: ['g1', { ...batch('evidence'), evidence: [{}] }, root] },
      { id: 'projection', method: 'companion.commit', args: ['g1', { ...batch('projection'), projections: [{}] }, root] },
      { id: 'translation', method: 'game.append', args: ['g1', [], 'translation'] },
    ])
    jest.mocked(pluginStorageCall).mockImplementation(async (method) => (method === 'companion.load' ? emptyMemorySnapshot({ recordingEnabled: false }) : (undefined as never)))
    await flushPendingStorage(root)
    expect(pluginStorageCall).not.toHaveBeenCalledWith('companion.commit', expect.anything())
    expect(pluginStorageCall).toHaveBeenLastCalledWith('game.append', ['g1', [], 'translation'])
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })
})
