import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import { BaseFetcher, type Fetcher, Updater } from 'tuf-js'
import { DownloadHTTPError } from 'tuf-js/dist/error'

import { UPDATE_METADATA_URL } from '@/constants/updates'
import type { OfflineMetadata } from '@/lib/updates/offline'
import { parseUpdatePackage, type UpdatePackage } from '@/lib/updates/protocol'

import { assertMetadataUrl } from './transport'

class MetadataFetcher extends BaseFetcher {
  async fetch(url: string): Promise<NodeJS.ReadableStream> {
    assertMetadataUrl(url)
    const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) {
      await response.body?.cancel()
      // tuf-js uses this class to recognize "no newer root" (403/404).
      throw new DownloadHTTPError(`Update metadata HTTP ${response.status}`, response.status)
    }
    if (!response.body) throw new Error('Missing metadata body')
    return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  }
}

export type TrustedSource = { refresh(offlineMetadata?: OfflineMetadata): Promise<UpdatePackage[]> }

class OfflineFetcher extends BaseFetcher {
  constructor(private files: OfflineMetadata) {
    super()
  }
  async fetch(url: string): Promise<NodeJS.ReadableStream> {
    assertMetadataUrl(url)
    const content = this.files[url.slice(UPDATE_METADATA_URL.length)]
    if (content === undefined) throw new DownloadHTTPError('Missing offline metadata', 404)
    return Readable.from(Buffer.from(content, 'utf8'))
  }
}

/** Caller holds the update lock; the persistent TUF cache retains rollback protection. */
export function createTrustedSource(directory: string, rootFile: string, fetcher: Fetcher = new MetadataFetcher()): TrustedSource {
  return {
    async refresh(offlineMetadata) {
      fs.mkdirSync(directory, { recursive: true })
      const root = path.join(directory, 'root.json')
      if (!fs.existsSync(root)) {
        if (!fs.existsSync(rootFile)) throw new Error('Official update trust root is not provisioned; bundled translation remains available')
        // Only a host-provisioned root may bootstrap trust, never one fetched from the channel.
        const bootstrap = path.join(directory, 'bootstrap.tmp')
        fs.copyFileSync(rootFile, bootstrap)
        fs.renameSync(bootstrap, root)
      }
      const updater = new Updater({
        metadataDir: directory,
        metadataBaseUrl: UPDATE_METADATA_URL,
        fetcher: offlineMetadata ? new OfflineFetcher(offlineMetadata) : fetcher,
        config: { maxRootRotations: 32, maxDelegations: 0, rootMaxLength: 65_536, timestampMaxLength: 16_384, snapshotMaxLength: 65_536, targetsMaxLength: 1_000_000 },
      })
      await updater.refresh()
      const document = JSON.parse(fs.readFileSync(path.join(directory, 'targets.json'), 'utf8')) as {
        signed: { targets: Record<string, unknown>; delegations?: unknown }
      }
      if (document.signed.delegations) throw new Error('Delegated targets are not supported by update protocol 1')
      const names = Object.keys(document.signed.targets)
      if (names.length > 256) throw new Error('Update catalog exceeds target limit')
      const items: UpdatePackage[] = []
      for (const name of names) {
        if (!/^[a-z0-9][a-z0-9._-]{0,199}$/.test(name) || name.includes('..')) throw new Error('Invalid target name')
        const target = await updater.getTargetInfo(name)
        if (!target) throw new Error('Missing verified update target')
        const descriptor = parseUpdatePackage(target.custom.chaya)
        if (target.length !== descriptor.length || target.hashes.sha256 !== descriptor.sha256) throw new Error('Signed target attributes disagree')
        items.push(descriptor)
      }
      return items
    },
  }
}
