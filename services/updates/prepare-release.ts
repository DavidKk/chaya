import { createHash } from 'node:crypto'

import { UPDATE_HOST_API, UPDATE_REPOSITORY } from '@/constants/updates'
import { type OfflineMetadata, parseOfflineUpdate } from '@/lib/updates/offline'
import { packageVersion, parseUpdatePackage } from '@/lib/updates/protocol'
import { parseResourcePack } from '@/services/translate/resources/validate'

/** Prepare immutable artifacts. Signing and publishing remain release-owner operations. */
export function prepareResourceRelease(content: string, version: string, notes = '') {
  packageVersion(version)
  const pack = parseResourcePack(content)
  const tag = `resources-${pack.manifest.packId}-v${version}`
  const asset = `${pack.manifest.packId}-${version}.jsonl`
  const target = asset
  const descriptor = parseUpdatePackage({
    protocolVersion: 1,
    packageId: pack.manifest.packId,
    packageVersion: version,
    kind: 'translation-resource',
    contentSchemaVersion: 1,
    hostApi: { min: UPDATE_HOST_API, max: UPDATE_HOST_API },
    activationPolicy: 'next-batch',
    url: `https://github.com/${UPDATE_REPOSITORY}/releases/download/${tag}/${asset}`,
    length: Buffer.byteLength(content, 'utf8'),
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    notes,
    resource: { packId: pack.manifest.packId, version: pack.manifest.version },
  })
  return {
    tag,
    asset,
    target,
    descriptor,
    content,
    targetEntry: { length: descriptor.length, hashes: { sha256: descriptor.sha256 }, custom: { chaya: descriptor } },
  }
}

export function prepareOfflineRelease(content: string, version: string, metadata: OfflineMetadata) {
  const pack = parseResourcePack(content)
  const bundle = { protocolVersion: 1 as const, packageId: pack.manifest.packId, packageVersion: packageVersion(version), metadata, content }
  return parseOfflineUpdate(JSON.stringify(bundle))
}
