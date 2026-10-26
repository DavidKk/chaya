import { prepareOfflineRelease, prepareResourceRelease } from '@/services/updates/prepare-release'

import { contentFor, sha, signedRepository } from './fixtures'

test('prepares a versioned asset with exact bytes and an independently versioned resource identity', () => {
  const content = contentFor('legacy-v1')
  const release = prepareResourceRelease(content, '2.0.0', 'Resource update')
  expect(release.descriptor).toMatchObject({
    packageVersion: '2.0.0',
    resource: { version: 'legacy-v1' },
    length: Buffer.byteLength(content),
    sha256: sha(content),
  })
  expect(release.tag.startsWith('resources-')).toBe(true)
  expect(release.targetEntry.custom.chaya).toEqual(release.descriptor)
  expect(release.descriptor.url.endsWith(`/${release.tag}/${release.asset}`)).toBe(true)
})

test('prepares an offline transport without adding a new trust root', () => {
  const repo = signedRepository()
  const metadata = Object.fromEntries([...repo.files].map(([name, content]) => [name, content.toString()]))
  expect(prepareOfflineRelease(contentFor(), '1.0.0', metadata)).toMatchObject({ packageId: 'chaya.test-ja-zh', metadata })
  expect(() => prepareOfflineRelease(contentFor(), '1.0.0', { ...metadata, 'root.json': repo.root.toString() })).toThrow()
})
