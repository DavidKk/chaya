jest.mock('@/services/storage/client', () => ({ storageCall: jest.fn() }))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { BaseFetcher } from 'tuf-js'

import { createTranslationResourceStore } from '@/services/storage/translation-resource-store'
import { loadResourceMatcher } from '@/services/translate/resources/snapshot'
import { createUpdateCoordinator } from '@/services/updates/coordinator'
import type { ResourceUpdatePort } from '@/services/updates/resources'
import { createTrustedSource } from '@/services/updates/source'
import { withUpdateState } from '@/services/updates/state'

import { contentFor, descriptorFor, signedRepository } from './fixtures'

let directory: string
let db: DatabaseSync
let store: ReturnType<typeof createTranslationResourceStore>
let port: ResourceUpdatePort
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-update-install-'))
  db = new DatabaseSync(path.join(directory, 'resources.sqlite'))
  store = createTranslationResourceStore(db)
  port = {
    install(content) {
      store.apply(content, store.preview(content).token, false)
    },
    activate(id, version) {
      store.activate(id, version)
    },
    list() {
      return store.list() as ReturnType<ResourceUpdatePort['list']>
    },
  }
})
afterEach(() => {
  db.close()
  fs.rmSync(directory, { recursive: true, force: true })
})
function setup() {
  const bodies = [contentFor(), contentFor('1.1.0', '呜呜')]
  const catalog = bodies.map((body, index) => descriptorFor(index === 0 ? '1.0.0' : '1.1.0', body))
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async (input) => {
    const index = catalog.findIndex((item) => item.url === input)
    return new Response(bodies[index])
  })
  const source = { refresh: jest.fn(async () => catalog) }
  const open = () => createUpdateCoordinator({ directory: path.join(directory, 'updates'), source, resources: port, fetch: fetcher })
  return { bodies, catalog, fetcher, source, open }
}
const pair = { sourceLanguage: 'ja', targetLanguage: 'zh' }

test('installs without activation, fixes old batch snapshots and rolls back offline', async () => {
  const { open, catalog, fetcher, source } = setup()
  const id = catalog[0].packageId
  const client = open()
  await client.install(id, '1.0.0')
  expect((await client.list())[0].active).toBe(false)
  await client.activate(id, '1.0.0')
  const oldBatch = loadResourceMatcher(path.join(directory, 'resources.sqlite'))
  expect(oldBatch.match('ああ', pair)?.targetText).toBe('啊啊')
  await client.install(id, '1.1.0')
  expect(loadResourceMatcher(path.join(directory, 'resources.sqlite')).match('ああ', pair)?.targetText).toBe('啊啊')
  await client.activate(id, '1.1.0')
  expect(oldBatch.match('ああ', pair)?.targetText).toBe('啊啊')
  expect(loadResourceMatcher(path.join(directory, 'resources.sqlite')).match('ああ', pair)?.targetText).toBe('呜呜')
  await expect(client.activate(id, '1.0.0')).rejects.toThrow('explicit local rollback')
  source.refresh.mockRejectedValue(new Error('Offline or expired metadata'))
  await open().activate(id, '1.0.0', true)
  expect(loadResourceMatcher(path.join(directory, 'resources.sqlite')).match('ああ', pair)?.targetText).toBe('啊啊')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('reinstall is idempotent and rejects remote downgrades and changed content identities', async () => {
  const { open, catalog, fetcher } = setup()
  const id = catalog[0].packageId
  await open().install(id, '1.0.0')
  await expect(open().install(id, '1.0.0')).resolves.toMatchObject({ reused: true })
  expect(fetcher).toHaveBeenCalledTimes(1)
  catalog[0] = { ...catalog[0], notes: 'changed immutable identity' }
  await expect(open().install(id, '1.0.0')).rejects.toThrow('immutable')
  await open().install(id, '1.1.0')
  await expect(open().install(id, '1.0.0')).rejects.toThrow('downgrade')
})

test('bad bytes, incompatible host and mismatched resource identity never activate', async () => {
  const { open, catalog, fetcher } = setup()
  const id = catalog[0].packageId
  fetcher.mockImplementation(async () => new Response('x'.repeat(catalog[0].length)))
  await expect(open().install(id, '1.0.0')).rejects.toThrow('checksum')
  expect(store.list()).toHaveLength(1)
  catalog[0] = { ...catalog[0], hostApi: { min: 2, max: 2 } }
  await expect(open().install(id, '1.0.0')).rejects.toThrow('host API')
})

test('rejects a validly hashed resource whose manifest differs from its signed identity', async () => {
  const { open, catalog, fetcher } = setup()
  const wrong = contentFor('2.0.0')
  catalog[0] = descriptorFor('1.0.0', wrong)
  fetcher.mockImplementation(async () => new Response(wrong))
  await expect(open().install(catalog[0].packageId, '1.0.0')).rejects.toThrow('identity')
  expect(store.list()).toHaveLength(1)
})

test('retries a retained install after storage failure without downloading again', async () => {
  const { open, catalog, fetcher } = setup()
  const install = jest.spyOn(port, 'install').mockImplementationOnce(() => {
    throw new Error('storage busy')
  })
  await expect(open().install(catalog[0].packageId, '1.0.0')).rejects.toThrow('storage busy')
  await expect(open().install(catalog[0].packageId, '1.0.0')).resolves.toMatchObject({ reused: true })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(install).toHaveBeenCalledTimes(2)
})

test('transient activation failure allows an offline retry and preserves the old active version', async () => {
  const { open, catalog, source } = setup()
  const id = catalog[0].packageId
  await open().install(id, '1.0.0')
  await open().activate(id, '1.0.0')
  await open().install(id, '1.1.0')
  jest.spyOn(port, 'activate').mockImplementationOnce(() => {
    throw new Error('storage busy')
  })
  await expect(open().activate(id, '1.1.0')).rejects.toThrow('storage busy')
  expect((await open().list()).find((row) => row.active)?.descriptor.packageVersion).toBe('1.0.0')
  source.refresh.mockRejectedValue(new Error('offline'))
  await expect(open().activate(id, '1.1.0')).resolves.toMatchObject({ version: '1.1.0' })
})

test('retained bytes are checked again before activation', async () => {
  const { open, catalog } = setup()
  await open().install(catalog[0].packageId, '1.0.0')
  fs.writeFileSync(path.join(directory, 'updates', 'packages', catalog[0].packageId, '1.0.0', 'content.jsonl'), 'tampered')
  await expect(open().activate(catalog[0].packageId, '1.0.0')).rejects.toThrow('integrity')
  expect(port.list().find((row) => row.packId === catalog[0].packageId)?.active).toBe(0)
})

test('crash recovery completes an install intent and an activation intent', async () => {
  const { open, catalog, bodies, source } = setup()
  const target = catalog[0]
  const updates = path.join(directory, 'updates')
  const staged = path.join(updates, 'staging', `${target.packageId}-${target.packageVersion}.jsonl`)
  fs.mkdirSync(path.dirname(staged), { recursive: true })
  fs.writeFileSync(staged, bodies[0])
  await withUpdateState(updates, async (state) => {
    state.save(target, 'installing')
  })
  expect(await open().list()).toMatchObject([{ phase: 'installed', active: false }])
  await withUpdateState(updates, async (state) => {
    state.save(target, 'activating')
  })
  source.refresh.mockRejectedValue(new Error('offline'))
  expect(await open().list()).toMatchObject([{ phase: 'installed', active: true }])
})

test('recovers an install intent persisted before staging rename', async () => {
  const { open, catalog, bodies, fetcher } = setup()
  const target = catalog[0]
  const updates = path.join(directory, 'updates')
  const download = path.join(updates, 'downloads', `${target.packageId}-${target.packageVersion}.jsonl`)
  fs.mkdirSync(path.dirname(download), { recursive: true })
  fs.writeFileSync(download, bodies[0])
  await withUpdateState(updates, async (state) => {
    state.save(target, 'installing')
  })
  expect(await open().list()).toMatchObject([{ phase: 'installed', active: false }])
  expect(fetcher).not.toHaveBeenCalled()
})

test('single writer excludes another coordinator and releases its lock on error', async () => {
  const { open } = setup()
  const updates = path.join(directory, 'updates')
  await withUpdateState(updates, async () => {
    await expect(open().list()).rejects.toThrow('Another update operation')
  })
  await expect(open().list()).resolves.toEqual([])
})

test('offline import uses the host root and persistent rollback protection without fetching', async () => {
  const repo = signedRepository()
  const root = path.join(directory, 'root.json')
  fs.writeFileSync(root, repo.root)
  const updates = path.join(directory, 'updates')
  class NoNetwork extends BaseFetcher {
    fetch = jest.fn(async (): Promise<NodeJS.ReadableStream> => {
      throw new Error('Network must not be used')
    })
  }
  const network = new NoNetwork()
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
  const open = () =>
    createUpdateCoordinator({
      directory: updates,
      resources: port,
      fetch: fetcher,
      source: createTrustedSource(path.join(updates, 'metadata'), root, network),
    })
  const bundle = (version: string, content: string) =>
    JSON.stringify({
      protocolVersion: 1,
      packageId: descriptorFor().packageId,
      packageVersion: version,
      content,
      metadata: Object.fromEntries([...repo.files].map(([name, value]) => [name, value.toString()])),
    })
  await expect(open().importOffline(bundle('1.0.0', contentFor()))).resolves.toMatchObject({ version: '1.0.0' })
  await open().activate(descriptorFor().packageId, '1.0.0')
  repo.publish(2, [descriptorFor('1.1.0')])
  await expect(open().importOffline(bundle('1.1.0', contentFor('1.1.0')))).resolves.toMatchObject({ version: '1.1.0' })
  repo.publish(1)
  await expect(open().importOffline(bundle('1.0.0', contentFor()))).rejects.toThrow()
  expect(network.fetch).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect((await open().list()).find((row) => row.active)?.descriptor.packageVersion).toBe('1.0.0')
})

test('offline import rejects substituted bytes and transport-supplied bootstrap roots', async () => {
  const { open, bodies, catalog } = setup()
  const bundle = {
    protocolVersion: 1,
    packageId: catalog[0].packageId,
    packageVersion: '1.0.0',
    content: bodies[1],
    metadata: { 'timestamp.json': '{}', 'snapshot.json': '{}', 'targets.json': '{}' },
  }
  await expect(open().importOffline(JSON.stringify(bundle))).rejects.toThrow('integrity')
  await expect(open().importOffline(JSON.stringify({ ...bundle, metadata: { ...bundle.metadata, 'root.json': '{}' } }))).rejects.toThrow('metadata file')
})

test('user game-scoped resource override survives an official update', async () => {
  const { open, catalog, bodies } = setup()
  const user = JSON.parse(bodies[0].split('\n')[0])
  const entry = JSON.parse(bodies[0].split('\n')[1])
  user.packId = 'user.mine'
  entry.targetText = '自定义'
  entry.scope = { kind: 'game', gameId: 'test-game' }
  const content = [user, entry].map((row) => JSON.stringify(row)).join('\n')
  store.apply(content, store.preview(content).token)
  await open().install(catalog[0].packageId, '1.0.0')
  await open().activate(catalog[0].packageId, '1.0.0')
  const matcher = loadResourceMatcher(path.join(directory, 'resources.sqlite'))
  expect(matcher.match('ああ', { ...pair, gameId: 'test-game' })?.targetText).toBe('自定义')
})
