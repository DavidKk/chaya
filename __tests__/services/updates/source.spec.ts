import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseUpdatePackage, selectUpdates } from '@/lib/updates/protocol'
import { createTrustedSource } from '@/services/updates/source'
import { assertMetadataUrl, fetchOfficialAsset } from '@/services/updates/transport'

import { descriptorFor, signedRepository } from './fixtures'

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-update-trust-'))
})
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const repo = signedRepository()
  const root = path.join(directory, 'bootstrap.json')
  fs.writeFileSync(root, repo.root)
  const open = () => createTrustedSource(path.join(directory, 'metadata'), root, repo.fetcher)
  return { repo, open }
}

test('accepts signed targets, persists trust and accepts a second release', async () => {
  const { repo, open } = setup()
  expect(await open().refresh()).toEqual([descriptorFor()])
  repo.publish(2, [descriptorFor(), descriptorFor('1.1.0')])
  expect(selectUpdates(await open().refresh())[0].packageVersion).toBe('1.1.0')
  repo.publish(1)
  await expect(open().refresh()).rejects.toThrow()
})

test('rejects tampered targets and retains accepted metadata', async () => {
  const { repo, open } = setup()
  await open().refresh()
  repo.publish(2)
  const changed = JSON.parse(repo.files.get('targets.json')!.toString())
  Object.values(changed.signed.targets).forEach((target) => {
    ;(target as { custom: { chaya: { notes: string } } }).custom.chaya.notes = 'tampered'
  })
  repo.files.set('targets.json', Buffer.from(JSON.stringify(changed)))
  await expect(open().refresh()).rejects.toThrow()
})

test('rejects expired signed metadata', async () => {
  const { repo, open } = setup()
  repo.publish(1, [descriptorFor()], '2020-01-01T00:00:00Z')
  await expect(open().refresh()).rejects.toThrow(/expired/i)
})

test('rejects an invalid timestamp signature even when its size and fields are unchanged', async () => {
  const { repo, open } = setup()
  const timestamp = JSON.parse(repo.files.get('timestamp.json')!.toString())
  const signature = timestamp.signatures[0].sig as string
  timestamp.signatures[0].sig = (signature.startsWith('00') ? 'ff' : '00') + signature.slice(2)
  repo.files.set('timestamp.json', Buffer.from(JSON.stringify(timestamp)))
  await expect(open().refresh()).rejects.toThrow(/sign/i)
})
test('never bootstraps from a network root or a fabricated bundled key', async () => {
  await expect(createTrustedSource(path.join(directory, 'metadata'), path.join(directory, 'absent.json')).refresh()).rejects.toThrow('not provisioned')
})

test('validates versions, host compatibility, namespaces and signed URL boundaries', () => {
  const item = descriptorFor()
  for (const value of ['../1', '1.1', '1.0.0-beta', '9007199254740992.0.0']) expect(() => parseUpdatePackage({ ...item, packageVersion: value })).toThrow()
  for (const url of [
    'https://example.org/test.jsonl',
    'https://github.com/attacker/chaya/releases/download/test/test.jsonl',
    'https://github.com/DavidKk/chaya/releases/latest/download/test.jsonl',
    `${item.url}?token=test`,
  ])
    expect(() => parseUpdatePackage({ ...item, url })).toThrow()
  expect(() => parseUpdatePackage({ ...item, resource: { ...item.resource, packId: 'user.data' } })).toThrow()
  expect(selectUpdates([parseUpdatePackage({ ...item, hostApi: { min: 2, max: 2 } })])).toEqual([])
  expect(() => selectUpdates([item, descriptorFor('2.0.0'), { ...item, notes: 'conflict' }])).toThrow('Conflicting')
  expect(() => assertMetadataUrl('https://raw.githubusercontent.com/attacker/root.json')).toThrow()
})

test('follows GitHub asset redirects and rejects unrelated destinations', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch')
  fetcher
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?sig=test' } }))
    .mockResolvedValueOnce(new Response('content'))
  expect(await (await fetchOfficialAsset(descriptorFor().url)).text()).toBe('content')
  expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' })
  fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.example/asset' } }))
  await expect(fetchOfficialAsset(descriptorFor().url)).rejects.toThrow('Untrusted')
})
